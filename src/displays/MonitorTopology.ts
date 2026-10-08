import { rectBottom, rectRight, type Rect } from '@/movement/types';
import type { DisplayInfo } from './types';

/** Which way you travel to get from one display to another. */
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';

export interface MonitorLink {
  readonly from: string;
  readonly to: string;
  readonly direction: TransitionDirection;
  /**
   * The span the two displays share along the shared edge, in virtual-desktop
   * coordinates. For a vertical link this is a range of x, for a horizontal
   * link a range of y. The companion must be inside this span to cross.
   */
  readonly overlapStart: number;
  readonly overlapEnd: number;
  /** True when the displays actually touch, rather than being merely nearest. */
  readonly touching: boolean;
}

/**
 * Pixels of slack when deciding whether two displays touch.
 *
 * Arrangements are rarely pixel-perfect — a user dragging monitors in display
 * settings can leave a small gap or overlap, and mixed scale factors introduce
 * rounding. Treating a near-miss as "not adjacent" would strand the companion
 * on one display.
 */
const TOUCH_TOLERANCE = 2;

/**
 * Works out how displays are arranged relative to one another.
 *
 * This is pure geometry over virtual-desktop coordinates: it never assumes
 * monitors are side by side, that the primary one starts at (0,0), or that
 * coordinates are positive. A vertical stack, a diagonal offset and mixed
 * resolutions are all ordinary input.
 */
export class MonitorTopology {
  private readonly links: readonly MonitorLink[];

  constructor(private readonly displays: readonly DisplayInfo[]) {
    this.links = buildLinks(displays);
  }

  get allLinks(): readonly MonitorLink[] {
    return this.links;
  }

  /** Every display reachable in one step from `displayId`. */
  linksFrom(displayId: string): readonly MonitorLink[] {
    return this.links.filter((link) => link.from === displayId);
  }

  /**
   * The link the companion would use to leave `displayId` in `direction`,
   * given where it currently is along the shared edge.
   *
   * `position` is the coordinate along the edge: x for up/down, y for
   * left/right. When several displays sit along the same edge, this picks the
   * one actually in front of the companion.
   */
  linkIn(displayId: string, direction: TransitionDirection, position: number): MonitorLink | null {
    const candidates = this.links.filter(
      (link) => link.from === displayId && link.direction === direction,
    );
    if (candidates.length === 0) return null;

    const containing = candidates.find(
      (link) => position >= link.overlapStart && position <= link.overlapEnd,
    );
    if (containing) return containing;

    // Not directly in front of any neighbour: use whichever shared edge is
    // closest, so walking into a corner still finds a way across.
    return candidates.reduce((best, link) =>
      edgeDistance(link, position) < edgeDistance(best, position) ? link : best,
    );
  }

  /** A point on the destination display that is inside the shared edge span. */
  crossingPoint(link: MonitorLink, position: number): number {
    const clamped = Math.min(Math.max(position, link.overlapStart), link.overlapEnd);
    return Math.round(clamped);
  }

  byId(id: string): DisplayInfo | null {
    return this.displays.find((display) => display.id === id) ?? null;
  }
}

function edgeDistance(link: MonitorLink, position: number): number {
  if (position < link.overlapStart) return link.overlapStart - position;
  if (position > link.overlapEnd) return position - link.overlapEnd;
  return 0;
}

function buildLinks(displays: readonly DisplayInfo[]): MonitorLink[] {
  const links: MonitorLink[] = [];

  for (const from of displays) {
    for (const to of displays) {
      if (from.id === to.id) continue;
      const link = linkBetween(from, to);
      if (link) links.push(link);
    }
  }

  // Any display with no touching neighbour would strand the companion, so give
  // it a link to its nearest peer. This covers gaps left by the user's display
  // arrangement, where monitors are close but not flush.
  for (const from of displays) {
    if (links.some((link) => link.from === from.id)) continue;
    const nearest = nearestOther(from, displays);
    if (nearest) links.push(fallbackLink(from, nearest));
  }

  return links;
}

function linkBetween(from: DisplayInfo, to: DisplayInfo): MonitorLink | null {
  const a = from.bounds;
  const b = to.bounds;

  // Vertical neighbours: one display's bottom edge meets the other's top edge,
  // and they overlap horizontally somewhere along it.
  const xOverlapStart = Math.max(a.x, b.x);
  const xOverlapEnd = Math.min(rectRight(a), rectRight(b));
  if (xOverlapEnd > xOverlapStart) {
    if (Math.abs(rectBottom(a) - b.y) <= TOUCH_TOLERANCE) {
      return { from: from.id, to: to.id, direction: 'down', overlapStart: xOverlapStart, overlapEnd: xOverlapEnd, touching: true };
    }
    if (Math.abs(rectBottom(b) - a.y) <= TOUCH_TOLERANCE) {
      return { from: from.id, to: to.id, direction: 'up', overlapStart: xOverlapStart, overlapEnd: xOverlapEnd, touching: true };
    }
  }

  // Horizontal neighbours: left/right edges meet with some vertical overlap.
  const yOverlapStart = Math.max(a.y, b.y);
  const yOverlapEnd = Math.min(rectBottom(a), rectBottom(b));
  if (yOverlapEnd > yOverlapStart) {
    if (Math.abs(rectRight(a) - b.x) <= TOUCH_TOLERANCE) {
      return { from: from.id, to: to.id, direction: 'right', overlapStart: yOverlapStart, overlapEnd: yOverlapEnd, touching: true };
    }
    if (Math.abs(rectRight(b) - a.x) <= TOUCH_TOLERANCE) {
      return { from: from.id, to: to.id, direction: 'left', overlapStart: yOverlapStart, overlapEnd: yOverlapEnd, touching: true };
    }
  }

  return null;
}

function nearestOther(from: DisplayInfo, displays: readonly DisplayInfo[]): DisplayInfo | null {
  let best: DisplayInfo | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of displays) {
    if (candidate.id === from.id) continue;
    const distance = centreDistance(from.bounds, candidate.bounds);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * A link to a display that does not touch. The direction is whichever axis
 * separates the two centres most, and the span is the full destination edge.
 */
function fallbackLink(from: DisplayInfo, to: DisplayInfo): MonitorLink {
  const dx = centreX(to.bounds) - centreX(from.bounds);
  const dy = centreY(to.bounds) - centreY(from.bounds);
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const direction: TransitionDirection = horizontal
    ? dx >= 0 ? 'right' : 'left'
    : dy >= 0 ? 'down' : 'up';

  const [overlapStart, overlapEnd] = horizontal
    ? [to.bounds.y, rectBottom(to.bounds)]
    : [to.bounds.x, rectRight(to.bounds)];

  return { from: from.id, to: to.id, direction, overlapStart, overlapEnd, touching: false };
}

const centreX = (rect: Rect): number => rect.x + rect.width / 2;
const centreY = (rect: Rect): number => rect.y + rect.height / 2;

function centreDistance(a: Rect, b: Rect): number {
  const dx = centreX(a) - centreX(b);
  const dy = centreY(a) - centreY(b);
  return dx * dx + dy * dy;
}
