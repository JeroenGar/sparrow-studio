import {readFileSync} from 'node:fs';
import {initSync} from '../../web/wasm/pkg/sparrow_web';
initSync({module:readFileSync(new URL('../../web/wasm/pkg/sparrow_web_bg.wasm',import.meta.url))});

import {initializeSVG} from '../src/engine/import/svg';
await initializeSVG();
