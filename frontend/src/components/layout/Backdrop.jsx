export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop__lamp" />
      <div className="backdrop__floor" />
      <div className="backdrop__grain" />
      <div className="backdrop__vignette" />
    </div>
  );
}
