/**
 * Booking widget loader. The host site includes this script once and adds:
 *   <div data-platform-embed="studio-slug"></div>
 *   <script src="https://<app-host>/embed.js"></script>
 * See docs/PUBLIC_API.md "Embed widget" for the full snippet and options.
 *
 * Plain script, no build step, no dependency: the host page never runs
 * anything more than this file. All booking logic lives inside the iframe,
 * served from this same origin at /embed/<slug>.
 */
(function () {
  var currentScript = document.currentScript;
  var origin = currentScript ? new URL(currentScript.src).origin : window.location.origin;

  function mount(container) {
    var slug = container.getAttribute('data-platform-embed');
    if (!slug) return;

    var iframe = document.createElement('iframe');
    iframe.src = origin + '/embed/' + encodeURIComponent(slug);
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.minHeight = '480px';
    iframe.setAttribute('title', 'Online rezervasyon');
    iframe.setAttribute('loading', 'lazy');
    container.appendChild(iframe);

    window.addEventListener('message', function (event) {
      if (event.origin !== origin) return; // only trust the widget's own origin
      var data = event.data;
      if (!data || data.type !== 'platform-embed-resize') return;
      if (typeof data.height !== 'number') return;
      iframe.style.height = data.height + 'px';
    });
  }

  function init() {
    var containers = document.querySelectorAll('[data-platform-embed]');
    for (var i = 0; i < containers.length; i++) mount(containers[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
