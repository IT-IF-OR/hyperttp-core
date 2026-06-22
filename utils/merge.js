"use strict";export function deepMerge(o,r){const e={...o};for(const n of Object.keys(r)){const t=r[n],u=e[n];if(c(t)&&c(u)){e[n]=deepMerge(u,t);continue}t!==void 0&&(e[n]=c(t)?deepMerge({},t):t)}return e}function c(o){return Object.prototype.toString.call(o)==="[object Object]"}
//# sourceMappingURL=merge.js.map
