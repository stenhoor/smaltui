// smaltui's engine settings for smaltkit's loader (vendor/smaltkit/engine.js, from stenhoor/smaltkit):
//
// ?engine=vendor (default)  ./vendor/smaltdb/: smaltdb with smaltql and the plugins smaltui uses, built from the commits
//                           pinned in packed.json by `npm run deps` (scripts/vendor-smaltdb.mjs)
// ?engine=https://…/        any folder built the same way, with smaltdb.js and smaltdb-worker.js
//
// npm engines (?engine=npm) are not offered: npm has only smaltdb 0.8.3, which has SQL built in and the older
// client API. A choice made in the Engine dialog is remembered in localStorage (smaltui.engine); ?engine= overrides it.

import type * as Smaltdb from 'smaltdb';
import type * as Io from '@smaltdb/io/client';
import type * as External from '@smaltdb/external/client';
import * as kit from '../vendor/smaltkit/engine.js';

export type { Database, OpenOptions, OpfsDatabase, SmaltdbModule } from '../vendor/smaltkit/engine.js';
export { deleteOpfsDatabase, listOpfsDatabases, opfsAvailable } from '../vendor/smaltkit/engine.js';
export type ArrayResult = Smaltdb.ArrayResult;

/** vendor/smaltdb/VERSION.json: smaltdb's version and commit, and every pinned package. */
export interface EngineVersion extends kit.EngineVersion {
  packages?: Record<string, { version: string; commit: string | null }>;
}

const KEY = 'smaltui.engine';
// Next to this module in the repo (app/ → vendor/) and in the built site (workbench/app/ → workbench/vendor/).
const VENDOR = new URL('../vendor/smaltdb/', import.meta.url);

export type Engine = Omit<kit.Engine, 'version'> & { version: EngineVersion | null };

export const engineSpec = (): string => {
  const spec = kit.engineSpec(KEY);
  if (!spec.startsWith('npm')) return spec;
  console.warn(`smaltui: engine "${spec}" is not available (npm has only smaltdb 0.8.3); using the bundled engine.`);
  return 'vendor';
};
export const setEngineSpec = (spec: string): void => kit.setEngineSpec(KEY, spec);
/**
 * vendor/smaltdb/smaltdb.js (scripts/vendor-smaltdb.mjs): the smaltdb client, plus the client helpers of the plugins
 * built into smaltui's engine worker. From smaltdb 0.9 these are functions that take the database (ADR 0012).
 */
export type Client = typeof Smaltdb & Pick<typeof Io, 'importCSV' | 'importJSON' | 'exportCSV' | 'exportJSON'> & Pick<typeof External, 'registerFile' | 'registerCredentials'>;

let client: Client | null = null;
const loaded = (): Client => {
  if (!client) throw new Error('the smaltdb engine is not loaded yet');
  return client;
};

export const loadEngine = async (spec: string = engineSpec()): Promise<Engine> => {
  const engine = await kit.loadEngine(spec, { vendorUrl: VENDOR, appName: 'smaltui' });
  // smaltkit falls back to npm when vendor/ is missing; npm has only smaltdb 0.8.3, which this code cannot run.
  if (engine.spec.startsWith('npm')) throw new Error('vendor/smaltdb is missing: run `npm run deps` to build the engine.');
  client = engine.module as Client;
  return engine;
};

// The plugin helpers of the loaded engine: importCSV(db, table, source, options) and so on.
export const importCSV: Client['importCSV'] = (...a) => loaded().importCSV(...a);
export const importJSON: Client['importJSON'] = (...a) => loaded().importJSON(...a);
export const exportCSV: Client['exportCSV'] = (...a) => loaded().exportCSV(...a);
export const exportJSON: Client['exportJSON'] = (...a) => loaded().exportJSON(...a);
export const registerFile: Client['registerFile'] = (...a) => loaded().registerFile(...a);
export const registerCredentials: Client['registerCredentials'] = (...a) => loaded().registerCredentials(...a);
