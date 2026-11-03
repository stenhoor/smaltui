// smaltui's engine settings for smaltkit's loader (vendor/smaltkit/engine.js, from stenhoor/smaltkit):
//
// ?engine=vendor (default)  ./vendor/smaltdb/, the npm package version pinned in package.json, copied there by
//                           `npm install` (scripts/vendor-smaltdb.mjs)
// ?engine=npm               the latest smaltdb on npm, from jsDelivr
// ?engine=npm@0.8.3         a specific npm version
// ?engine=https://…/dist/   any folder that serves smaltdb.js and smaltdb-worker.js
//
// A choice made in the About dialog is remembered in localStorage (smaltui.engine); ?engine= overrides it.

import type * as Smaltdb from 'smaltdb';
import * as kit from '../vendor/smaltkit/engine.js';

export type { Database, Engine, EngineVersion, OpenOptions, OpfsDatabase, SmaltdbModule } from '../vendor/smaltkit/engine.js';
export { deleteOpfsDatabase, listOpfsDatabases, opfsAvailable } from '../vendor/smaltkit/engine.js';
export type ArrayResult = Smaltdb.ArrayResult;

const KEY = 'smaltui.engine';
// Next to this module in the repo (app/ → vendor/) and in the built site (workbench/app/ → workbench/vendor/).
const VENDOR = new URL('../vendor/smaltdb/', import.meta.url);

export const engineSpec = (): string => kit.engineSpec(KEY);
export const setEngineSpec = (spec: string): void => kit.setEngineSpec(KEY, spec);
export const loadEngine = (spec: string = engineSpec()): Promise<kit.Engine> => kit.loadEngine(spec, { vendorUrl: VENDOR, appName: 'smaltui' });
