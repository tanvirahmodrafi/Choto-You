import type { AnimationPlayer } from '@/animation/AnimationPlayer';
import { AnimationPriority } from '@/animation/types';
import type { DisplayInfo } from '@/displays/types';
import type { MonitorLink, MonitorTopology } from '@/displays/MonitorTopology';
import { createLogger } from '@/utils/logger';
import type { BoundaryDetector } from './BoundaryDetector';
import type { MovementEngine } from './MovementEngine';

const log = createLogger('MOVE');

/**
 * Stages of crossing from one display to another.
 *
 * Kept as an explicit sequence rather than a tangle of flags so the transition
 * is debuggable: at any moment there is one named stage, and the log reads as
 * a story.
 */
export type TransitionStage =
  | 'idle'
  | 'approaching_edge'
  | 'looking'
  | 'jumping'
  | 'falling'
  | 'landing'
  | 'recovering';

export interface TransitionCallbacks {
  /** Applies the destination display's work area before the companion lands. */
  readonly onEnterDisplay: (display: DisplayInfo) => void;
  readonly onComplete: () => void;
}

/** How long the companion pauses to "notice" the edge, in seconds. */
const LOOK_DURATION = 0.45;
/** How long the landing animation is held before normal behaviour resumes. */
const RECOVER_DURATION = 0.35;

/**
 * Walks the companion across a monitor boundary instead of teleporting it.
 *
 * Topology (which displays touch, and where) is kept entirely separate from
 * this sequencing logic: this class asks the topology where it can go, then
 * plays out the movement and animation.
 */
export class MonitorTransition {
  private stage: TransitionStage = 'idle';
  private timer = 0;
  private link: MonitorLink | null = null;
  private destination: DisplayInfo | null = null;
  private callbacks: TransitionCallbacks | null = null;

  constructor(
    private readonly movement: MovementEngine,
    private readonly boundaries: BoundaryDetector,
    private readonly player: AnimationPlayer,
    private readonly topology: MonitorTopology,
  ) {}

  get isActive(): boolean {
    return this.stage !== 'idle';
  }

  get currentStage(): TransitionStage {
    return this.stage;
  }

  /**
   * Begins a crossing.
   * @returns false when the destination is not reachable from here.
   */
  begin(
    fromDisplayId: string,
    direction: 'left' | 'right' | 'up' | 'down',
    callbacks: TransitionCallbacks,
  ): boolean {
    const { position } = this.movement.getSnapshot();
    // Vertical moves are chosen by x along the shared edge; horizontal by y.
    const along = direction === 'up' || direction === 'down' ? position.x : position.y;

    const link = this.topology.linkIn(fromDisplayId, direction, along);
    if (!link) {
      log.debug(`No display ${direction} of ${fromDisplayId}`);
      return false;
    }
    const destination = this.topology.byId(link.to);
    if (!destination) return false;

    this.link = link;
    this.destination = destination;
    this.callbacks = callbacks;
    log.info(`Monitor transition requested: ${fromDisplayId} -> ${link.to} (${direction})`);

    // Walk to the point on the shared edge that actually lines up with the
    // destination, otherwise the companion would step off into empty space.
    const edgeX = this.topology.crossingPoint(link, position.x);
    this.setStage('approaching_edge');
    this.player.play('walk', { priority: AnimationPriority.NORMAL });
    this.movement.walkTo(edgeX, () => this.setStage('looking'));
    return true;
  }

  update(delta: number): void {
    if (this.stage === 'idle') return;
    this.timer += delta;

    switch (this.stage) {
      case 'looking':
        if (this.timer >= LOOK_DURATION) this.jump();
        break;
      case 'jumping':
      case 'falling':
        if (this.movement.getSnapshot().grounded) this.land();
        break;
      case 'recovering':
        if (this.timer >= RECOVER_DURATION) this.finish();
        break;
      default:
        break;
    }
  }

  /** Abandons the crossing, e.g. because the user grabbed the companion. */
  cancel(): void {
    if (this.stage === 'idle') return;
    log.info('Monitor transition cancelled');
    this.reset();
  }

  private jump(): void {
    const destination = this.destination;
    const link = this.link;
    if (!destination || !link) return this.reset();

    this.setStage('jumping');
    this.player.play('jump', { priority: AnimationPriority.NORMAL });

    // Hand the destination's work area over *before* positioning, so the
    // boundary detector clamps against the display being entered rather than
    // the one being left.
    this.callbacks?.onEnterDisplay(destination);

    const { position } = this.movement.getSnapshot();
    const entry = entryPosition(link, destination, this.boundaries, position.x);
    this.movement.setPosition(entry, 'falling');
    this.setStage('falling');
  }

  private land(): void {
    this.setStage('landing');
    this.player.play('land', { priority: AnimationPriority.NORMAL });
    this.setStage('recovering');
  }

  private finish(): void {
    log.info('Monitor transition complete');
    const callbacks = this.callbacks;
    this.reset();
    this.player.play('idle', { priority: AnimationPriority.AMBIENT, force: true });
    callbacks?.onComplete();
  }

  private setStage(stage: TransitionStage): void {
    if (this.stage === stage) return;
    log.debug(`transition ${this.stage} -> ${stage}`);
    this.stage = stage;
    this.timer = 0;
  }

  private reset(): void {
    this.stage = 'idle';
    this.timer = 0;
    this.link = null;
    this.destination = null;
    this.callbacks = null;
  }
}

/**
 * Where the companion appears on the display it is entering.
 *
 * Crossing upward means arriving at the *bottom* of the display above, and
 * crossing downward means arriving at its top and falling. Sideways crossings
 * keep their height and enter just inside the near edge.
 */
function entryPosition(
  link: MonitorLink,
  destination: DisplayInfo,
  boundaries: BoundaryDetector,
  currentX: number,
) {
  const area = destination.workArea;
  const size = boundaries.companionSize;

  switch (link.direction) {
    case 'up':
      // Arrive standing on the floor of the display above.
      return { x: clampToEdge(link, currentX), y: area.y + area.height - size.height };
    case 'down':
      // Arrive at the top and fall to the floor.
      return { x: clampToEdge(link, currentX), y: area.y };
    case 'right':
      return { x: area.x, y: area.y + area.height - size.height };
    case 'left':
      return { x: area.x + area.width - size.width, y: area.y + area.height - size.height };
  }
}

function clampToEdge(link: MonitorLink, x: number): number {
  return Math.min(Math.max(x, link.overlapStart), link.overlapEnd);
}
