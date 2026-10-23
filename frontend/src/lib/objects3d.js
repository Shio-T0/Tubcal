// Whether 3D objects are on (Settings → Appearance, setting `objects_3d`; the
// installer's `3d` option). Until the settings arrive, the page the server
// stamped says so (<html data-3d>), so the first render already knows.

import { useSettings } from '../state.jsx';

export function useObjects3d() {
  const { settings } = useSettings();
  return settings ? settings.objects_3d === true : document.documentElement.hasAttribute('data-3d');
}
