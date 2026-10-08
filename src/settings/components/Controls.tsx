import type { ReactNode } from 'react';

/** A labelled group of related settings. */
export function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="section">
      <h2 className="section__title">{title}</h2>
      <div className="section__body">{children}</div>
    </section>
  );
}

export function Row({
  label,
  hint,
  control,
  stack = false,
}: {
  readonly label: string;
  /** Explicitly allows undefined: callers build rows conditionally. */
  readonly hint?: string | undefined;
  readonly control: ReactNode;
  /**
   * Puts the control on its own line below the label. For controls too wide to
   * sit beside it, such as the avatar grid.
   */
  readonly stack?: boolean;
}) {
  return (
    <div className="row" data-stack={stack ? 'true' : 'false'}>
      <div className="row__text">
        <span className="row__label">{label}</span>
        {hint ? <span className="row__hint">{hint}</span> : null}
      </div>
      <div className="row__control">{control}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
  readonly label: string;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        aria-label={label}
      />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
    </label>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  format,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
  readonly label: string;
  readonly format?: (value: number) => string;
}) {
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        aria-label={label}
      />
      <span className="slider__value">{format ? format(value) : String(value)}</span>
    </div>
  );
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly label: string;
}) {
  return (
    <select
      className="choice"
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.currentTarget.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Button({
  children,
  onClick,
  tone = 'normal',
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly tone?: 'normal' | 'danger';
}) {
  return (
    <button className="button" data-tone={tone} type="button" onClick={onClick}>
      {children}
    </button>
  );
}
