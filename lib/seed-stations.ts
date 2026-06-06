import { createClient } from '@supabase/supabase-js';
import { STATIONS } from '@/lib/fusionsolar';
import { LivoltkClient, loadLivoltkEnv, getAllSites } from '@/lib/livoltek';

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function seedStations(): Promise<{
  fusionsolar: number;
  livoltek: number;
  total: number;
}> {
  const supabase = getClient();

  // FusionSolar — hardcoded from STATIONS constant
  const fsRows = STATIONS.map(s => ({
    source:      'fusionsolar',
    source_code: s.code,
    name:        s.name,
    location:    s.location,
  }));

  // LIVOLTEK — fetched live from the API
  const { email, password, accountType } = loadLivoltkEnv();
  const client = new LivoltkClient(email, password, accountType);
  const sites = await getAllSites(client);

  const lvRows = sites.map(s => ({
    source:      'livoltek',
    source_code: String(s.id),
    name:        s.name,
    location:    s.adress ?? null,
    capacity_kw: s.pvCapacity ?? null,
    latitude:    s.latitude ?? null,
    longitude:   s.longitude ?? null,
  }));

  const allRows = [...fsRows, ...lvRows];

  const { error } = await supabase
    .from('stations')
    .upsert(allRows, { onConflict: 'source,source_code' });

  if (error) throw new Error(`seedStations: ${error.message}`);

  return {
    fusionsolar: fsRows.length,
    livoltek:    lvRows.length,
    total:       allRows.length,
  };
}
