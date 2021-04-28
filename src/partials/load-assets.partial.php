/**
 * Loader utils
 */

function str_ends_with( $haystack, $needle ) {
  $length = strlen( $needle );
  if( !$length ) {
      return true;
  }
  return substr( $haystack, -$length ) === $needle;
}

function is_js($path) {
  return str_ends_with($path, "js");
}

function is_css($path) {
  return str_ends_with($path, "css");
}

function get_js_for_entrypoint($entrypoint) {
  $assets = $manifest[$entrypoint];
  $js = array_filter($assets, "is_js");
  return $js;
}

function get_css_for_entrypoint($entrypoint) {
  $assets = $manifest[$entrypoint];
  $css = array_filter($assets, "is_css");
  return $css;
}

function register_assets($entrypoint) {
  $js = get_js_for_entrypoint($entrypoint);

  foreach ($js as &$script) {
    wp_register_script($script, plugins_url($script));
  }

  $css = get_css_for_entrypoint($entrypoint);

  foreach ($css as &$style) {
    wp_register_style($style, plugins_url($style));
  }
}

function enqueue_assets($entrypoint) {
  $js = get_js_for_entrypoint($entrypoint);

  foreach ($js as &$script) {
    wp_enqueue_script($script);
  }

  $css = get_css_for_entrypoint($entrypoint);

  foreach ($css as &$style) {
    wp_enqueue_style($style);
  }
}