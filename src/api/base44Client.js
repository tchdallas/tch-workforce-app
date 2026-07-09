// Compatibility shim: every screen imports { base44 } from here. The export is
// now the Supabase-backed data layer with the same API surface as the old SDK.
import { dataClient } from './dataClient';

export const base44 = dataClient;
