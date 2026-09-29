// The gap between the two events (6s) is deliberately longer than the idle
// timeout the test runs the server with (IDLE_TIMEOUT=2). The second event
// only reaches the client if the adapter cleared Bun's idle timeout for this
// `text/event-stream` response.
export function GET() {
	const stream = new ReadableStream({
		async start(controller) {
			controller.enqueue("data: 0\n\n");
			await new Promise((resolve) => setTimeout(resolve, 6000));
			controller.enqueue("data: 1\n\n");
			controller.close();
		},
	});

	return new Response(stream, {
		headers: {
			"cache-control": "no-cache",
			"content-type": "text/event-stream",
		},
	});
}
