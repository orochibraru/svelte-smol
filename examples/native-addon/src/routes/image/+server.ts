import sharp from "sharp";

// Rendered by the native `sharp` addon at request time. If this route returns
// a PNG, `sharp` loaded from `node_modules` next to the `build/index.js`
// bundle, which is the whole point of `adapter({ compile: false })`.
export async function GET() {
	const size = 240;
	const png = await sharp({
		create: {
			width: size,
			height: size,
			channels: 4,
			background: { r: 12, g: 122, b: 210, alpha: 1 },
		},
	})
		.composite([
			{
				input: Buffer.from(
					`<svg width="${size}" height="${size}">
						<circle cx="${size / 2}" cy="${size / 2}" r="${size / 3}" fill="#fff" opacity="0.85"/>
					</svg>`,
				),
				top: 0,
				left: 0,
			},
		])
		.png()
		.toBuffer();

	return new Response(new Uint8Array(png), {
		headers: {
			"content-type": "image/png",
			"cache-control": "no-store",
		},
	});
}
