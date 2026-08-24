export function BrandLogo() {
  return (
    <div className="brand-logo" aria-label="HeatShield">
      <img
        className="brand-logo__mark"
        src="/heatshield-logo.png"
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <span className="brand-logo__wordmark"><strong>Heat</strong><span>Shield</span></span>
    </div>
  )
}
