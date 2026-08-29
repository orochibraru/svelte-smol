<h1>svelte-smol + a native addon</h1>

<p>
	This app depends on <a href="https://sharp.pixelplumbing.com/"><code>sharp</code></a>,
	a native module. It's built with <code>adapter(&#123; compile: false &#125;)</code>,
	so the output is <code>build/index.js</code> (run with <code>bun</code>) rather
	than a single compiled binary.
</p>

<p>The image below is generated on the server by <code>sharp</code> per request:</p>

<img src="/image" alt="a gradient rendered by sharp" width="240" height="240" />
