import adapter from "../../../index.ts";

// The integration suite builds this fixture in both modes: `SMOL_COMPILE=false`
// exercises the plain `build/index.js` bundle path.
const compile = process.env.SMOL_COMPILE !== "false";

/** @type {import('@sveltejs/kit').Config} */
export default {
	kit: {
		adapter: adapter({ compile }),
	},
};
