import { useSettings } from '../../state.jsx';

// Each skin paints its own ambient layers behind the content (z-index 0). The
// Shōwa night/day look keeps the original lamp + scanline set; the other skins
// swap in their signature atmosphere. All layer styling lives in backdrop.css.

function ShowaLayers() {
  return (
    <>
      <div className="backdrop__lamp" />
      <div className="backdrop__floor" />
      <div className="backdrop__scan" />
      <div className="backdrop__grain" />
      <div className="backdrop__vignette" />
    </>
  );
}

function TerminalLayers() {
  return (
    <>
      <div className="bd-term__scan" />
      <div className="bd-term__flicker" />
      <div className="bd-term__vignette" />
    </>
  );
}

function AquaLayers() {
  return (
    <>
      <div className="bd-aqua__sky" />
      <div className="bd-aqua__pin" />
    </>
  );
}

function BauhausLayers() {
  return (
    <>
      <div className="bd-bau__circle" />
      <div className="bd-bau__bar" />
      <div className="bd-bau__tri" />
    </>
  );
}

function BlueprintLayers() {
  return (
    <>
      <div className="bd-bp__grid" />
      <div className="bd-bp__grid bd-bp__grid--fine" />
      <div className="bd-bp__vignette" />
    </>
  );
}

function SpaceLayers() {
  return (
    <>
      <div className="bd-space__nebula" />
      <div className="bd-space__stars" />
      <div className="bd-space__stars bd-space__stars--far" />
    </>
  );
}

const LAYERS = {
  terminal: TerminalLayers,
  aqua: AquaLayers,
  bauhaus: BauhausLayers,
  blueprint: BlueprintLayers,
  space: SpaceLayers,
};

export default function Backdrop() {
  const { settings } = useSettings();
  const theme = settings?.theme || 'dark';
  const Layers = LAYERS[theme] || ShowaLayers;
  return (
    <div className="backdrop" aria-hidden="true">
      <Layers />
    </div>
  );
}
