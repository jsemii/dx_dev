import './smooth-toggle.css';

export default function SmoothToggle({ checked, onChange, label, disabled = false, size = 'regular' }) {
  return (
    <button
      type="button"
      className={`smooth-toggle smooth-toggle--${size}${checked ? ' smooth-toggle--checked' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="smooth-toggle__thumb" aria-hidden="true" />
    </button>
  );
}
