export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop__ember" />
      <div className="backdrop__ember backdrop__ember--2" />
      <div className="backdrop__rings" />
      <div className="backdrop__grain" />
      <div className="backdrop__vignette" />
    </div>
  );
}
