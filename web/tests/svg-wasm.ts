import {readFileSync} from 'node:fs';
import {initSync} from '../wasm/pkg/sparrow_web';
initSync({module:readFileSync(new URL('../wasm/pkg/sparrow_web_bg.wasm',import.meta.url))});

import {initializeSVG} from '../src/import/svg';
await initializeSVG();
