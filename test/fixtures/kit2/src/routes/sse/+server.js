export function GET() {
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue("data: hello\n\n");
			controller.close();
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
		},
	});
}
