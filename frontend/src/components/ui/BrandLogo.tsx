export function BrandLogo() {
  return (
    <div className="brand-logo" aria-label="HeatShield">
      <svg className="brand-logo__mark" viewBox="0 0 44 50" role="img" aria-hidden="true">
        <path d="M22 2 40 8v14c0 12-7.6 21.5-18 26C11.6 43.5 4 34 4 22V8L22 2Z" fill="#0b8b87" />
        <path d="M22 6.5 35.5 11v11c0 9-5.3 16.6-13.5 20.6C13.8 38.6 8.5 31 8.5 22V11L22 6.5Z" fill="#fff" />
        <circle cx="22" cy="23" r="6" fill="#ff9b23" />
        <g stroke="#ff9b23" strokeWidth="1.7" strokeLinecap="round">
          <path d="M22 12.5v4" /><path d="M22 29.5v4" /><path d="M11.5 23h4" /><path d="M28.5 23h4" />
          <path d="m14.6 15.6 2.8 2.8" /><path d="m26.6 27.6 2.8 2.8" /><path d="m29.4 15.6-2.8 2.8" /><path d="m17.4 27.6-2.8 2.8" />
        </g>
      </svg>
      <span className="brand-logo__wordmark"><strong>Heat</strong><span>Shield</span></span>
    </div>
  )
}
