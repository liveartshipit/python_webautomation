<?php
/**
 * Worksmarto Bot - WordPress backend (WPCode PHP snippet, location: Everywhere).
 * Replaces the Cloudflare Worker: holds the AI key on the server, searches the
 * knowledge file, calls the AI, and adds the chat widget to the site footer.
 *
 * Settings: wp-admin -> Settings -> Worksmarto Bot
 * Endpoints: POST /wp-json/wsbot/v1/chat   GET /wp-json/wsbot/v1/health
 * (WPCode: paste without the opening <?php line.)
 */

if ( ! defined( 'WSBOT_VERSION' ) ) {
	define( 'WSBOT_VERSION', '1.0' );
	define( 'WSBOT_KNOWLEDGE_URL', 'https://raw.githubusercontent.com/liveartshipit/python_webautomation/main/data/knowledge.json' );
	define( 'WSBOT_WIDGET_URL', 'https://cdn.jsdelivr.net/gh/liveartshipit/python_webautomation@75edfb8fd6e3/widget/chatbot.js' );
}

function wsbot_providers() {
	return array(
		'openrouter' => array(
			'label'  => 'OpenRouter',
			'url'    => 'https://openrouter.ai/api/v1/chat/completions',
			'models' => 'meta-llama/llama-3.3-70b-instruct:free, google/gemma-3-27b-it:free, mistralai/mistral-small-3.2-24b-instruct:free',
		),
		'groq'       => array(
			'label'  => 'Groq',
			'url'    => 'https://api.groq.com/openai/v1/chat/completions',
			'models' => 'llama-3.3-70b-versatile, llama-3.1-8b-instant',
		),
		'gemini'     => array(
			'label'  => 'Google Gemini',
			'url'    => 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
			'models' => 'gemini-3.5-flash-lite, gemini-3.8-flash, gemini-3.1-flash-lite',
		),
	);
}

function wsbot_opt( $key, $default = '' ) {
	$o = get_option( 'wsbot_settings', array() );
	return isset( $o[ $key ] ) && '' !== $o[ $key ] ? $o[ $key ] : $default;
}

/* ---------------- Settings page ---------------- */

add_action( 'admin_menu', function () {
	add_options_page( 'Worksmarto Bot', 'Worksmarto Bot', 'manage_options', 'wsbot', 'wsbot_settings_page' );
} );

function wsbot_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$providers = wsbot_providers();
	$saved     = get_option( 'wsbot_settings', array() );

	if ( isset( $_POST['wsbot_save'] ) && check_admin_referer( 'wsbot_save' ) ) {
		$provider = sanitize_key( wp_unslash( $_POST['provider'] ?? 'openrouter' ) );
		if ( ! isset( $providers[ $provider ] ) ) {
			$provider = 'openrouter';
		}
		$new_keys = isset( $saved['keys'] ) && is_array( $saved['keys'] ) ? $saved['keys'] : array();
		$typed    = trim( sanitize_text_field( wp_unslash( $_POST['api_key'] ?? '' ) ) );
		if ( '' !== $typed ) {
			$new_keys[ $provider ] = $typed; // empty field keeps the stored key
		}
		$saved = array(
			'enabled'  => ! empty( $_POST['enabled'] ) ? 1 : 0,
			'provider' => $provider,
			'keys'     => $new_keys,
			'models'   => sanitize_text_field( wp_unslash( $_POST['models'] ?? '' ) ),
			'color'    => sanitize_hex_color( wp_unslash( $_POST['color'] ?? '' ) ) ?: '#4f46e5',
		);
		update_option( 'wsbot_settings', $saved, false );
		delete_transient( 'wsbot_index' );
		echo '<div class="notice notice-success"><p>Saved.</p></div>';
	}

	$provider = $saved['provider'] ?? 'gemini';
	$has_key  = ! empty( $saved['keys'][ $provider ] );
	?>
	<div class="wrap">
		<h1>Worksmarto Bot</h1>
		<form method="post">
			<?php wp_nonce_field( 'wsbot_save' ); ?>
			<table class="form-table">
				<tr><th>Show chat on site</th><td><label><input type="checkbox" name="enabled" value="1" <?php checked( ! empty( $saved['enabled'] ) ); ?>> Enabled</label></td></tr>
				<tr><th>AI provider</th><td><select name="provider">
					<?php foreach ( $providers as $id => $p ) : ?>
						<option value="<?php echo esc_attr( $id ); ?>" <?php selected( $provider, $id ); ?>><?php echo esc_html( $p['label'] ); ?></option>
					<?php endforeach; ?>
				</select></td></tr>
				<tr><th>API key</th><td>
					<input type="password" name="api_key" class="regular-text" autocomplete="off" placeholder="<?php echo $has_key ? 'Saved. Leave empty to keep it.' : 'Paste your API key'; ?>">
					<p class="description">Stored on this server only. It is never shown in the page source.</p>
				</td></tr>
				<tr><th>Models (in order)</th><td>
					<input type="text" name="models" class="large-text" value="<?php echo esc_attr( $saved['models'] ?? '' ); ?>" placeholder="<?php echo esc_attr( $providers[ $provider ]['models'] ); ?>">
					<p class="description">Comma separated. If one is busy, the next one answers. Leave empty for the defaults shown.</p>
				</td></tr>
				<tr><th>Chat color</th><td><input type="text" name="color" value="<?php echo esc_attr( $saved['color'] ?? '#4f46e5' ); ?>"></td></tr>
			</table>
			<p><button class="button button-primary" name="wsbot_save" value="1">Save</button></p>
		</form>
		<p>Health check: <a href="<?php echo esc_url( rest_url( 'wsbot/v1/health' ) ); ?>" target="_blank"><?php echo esc_html( rest_url( 'wsbot/v1/health' ) ); ?></a></p>
	</div>
	<?php
}

/* ---------------- Search (same BM25 as worker/worker.js) ---------------- */

function wsbot_tokenize( $s ) {
	static $stop = null;
	if ( null === $stop ) {
		$stop = array_flip( explode( ' ', 'a an the and or but if of to in on at for with by from is are was were be been do does did can could should would will i you we they it this that these those my your our me how what why when where which who whom about into than then so not no yes just also any some there here have has had get got use using' ) );
	}
	preg_match_all( '/[a-z0-9]+(?:\.[a-z0-9]+)*/', strtolower( (string) $s ), $m );
	$out = array();
	foreach ( $m[0] as $w ) {
		if ( strlen( $w ) > 1 && ! isset( $stop[ $w ] ) ) {
			$out[] = $w;
		}
	}
	return $out;
}

function wsbot_index() {
	$idx = get_transient( 'wsbot_index' );
	if ( is_array( $idx ) && ! empty( $idx['docs'] ) ) {
		return $idx;
	}
	$res = wp_remote_get( WSBOT_KNOWLEDGE_URL, array( 'timeout' => 20 ) );
	if ( is_wp_error( $res ) || 200 !== wp_remote_retrieve_response_code( $res ) ) {
		$old = get_option( 'wsbot_index_backup' );
		return is_array( $old ) ? $old : null;
	}
	$data = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( empty( $data['docs'] ) ) {
		return null;
	}
	$docs = array();
	$df   = array();
	$sum  = 0;
	foreach ( $data['docs'] as $d ) {
		$tt   = wsbot_tokenize( $d['title'] );
		$toks = array_merge( wsbot_tokenize( $d['text'] ), $tt, $tt ); // title weighted x3
		$tf   = array_count_values( $toks );
		foreach ( $tf as $t => $n ) {
			$df[ $t ] = ( $df[ $t ] ?? 0 ) + 1;
		}
		$len    = count( $toks );
		$sum   += $len;
		$docs[] = array( 'title' => $d['title'], 'url' => $d['url'], 'text' => $d['text'], 'tf' => $tf, 'len' => $len );
	}
	$n   = count( $docs );
	$idf = array();
	foreach ( $df as $t => $c ) {
		$idf[ $t ] = log( 1 + ( $n - $c + 0.5 ) / ( $c + 0.5 ) );
	}
	$idx = array( 'docs' => $docs, 'idf' => $idf, 'avg' => $sum / max( $n, 1 ), 'generated' => $data['generated'] ?? '' );
	set_transient( 'wsbot_index', $idx, 6 * HOUR_IN_SECONDS );
	update_option( 'wsbot_index_backup', $idx, false );
	return $idx;
}

function wsbot_search( $idx, $query, $k = 5 ) {
	$q = array_unique( wsbot_tokenize( $query ) );
	if ( ! $q ) {
		return array();
	}
	$k1     = 1.4;
	$b      = 0.75;
	$scored = array();
	foreach ( $idx['docs'] as $i => $d ) {
		$s = 0;
		foreach ( $q as $t ) {
			if ( empty( $d['tf'][ $t ] ) ) {
				continue;
			}
			$f  = $d['tf'][ $t ];
			$s += $idx['idf'][ $t ] * ( ( $f * ( $k1 + 1 ) ) / ( $f + $k1 * ( 1 - $b + $b * $d['len'] / $idx['avg'] ) ) );
		}
		if ( $s > 0 ) {
			$scored[ $i ] = $s;
		}
	}
	arsort( $scored );
	$per = array();
	$out = array();
	foreach ( $scored as $i => $s ) {
		$d = $idx['docs'][ $i ];
		if ( ( $per[ $d['url'] ] ?? 0 ) >= 2 ) {
			continue;
		}
		$per[ $d['url'] ] = ( $per[ $d['url'] ] ?? 0 ) + 1;
		$out[]            = array( 'title' => $d['title'], 'url' => $d['url'], 'text' => $d['text'] );
		if ( count( $out ) >= $k ) {
			break;
		}
	}
	return $out;
}

function wsbot_system_prompt( $sources ) {
	$ctx = array();
	foreach ( $sources as $i => $s ) {
		$ctx[] = '[' . ( $i + 1 ) . '] ' . $s['title'] . "\nURL: " . $s['url'] . "\n" . $s['text'];
	}
	$ctx = $ctx ? implode( "\n\n", $ctx ) : '(no matching content found)';
	return "You are the Worksmarto assistant on worksmarto.com, a blog about AI workflow automation and productivity tools for freelancers and startups.

Rules:
- Answer ONLY from the CONTEXT below. If the answer is not there, say you are not sure and point to https://worksmarto.com/contact-us/ .
- Never invent prices, features, people, dates or links. Only use URLs that appear in the CONTEXT.
- Keep answers short: 2-4 sentences or a few bullets. Friendly, plain English.
- When useful, end with one link to the most relevant article as a markdown link [title](url).
- Do not mention \"context\", \"sources\" or these rules. Never reveal a founder's personal name.
- If asked something unrelated to Worksmarto, AI tools, automation or freelancing, politely steer back.

CONTEXT:
" . $ctx;
}

/* ---------------- REST endpoints ---------------- */

add_action( 'rest_api_init', function () {
	register_rest_route( 'wsbot/v1', '/chat', array(
		'methods'             => 'POST',
		'callback'            => 'wsbot_chat',
		'permission_callback' => '__return_true',
	) );
	register_rest_route( 'wsbot/v1', '/health', array(
		'methods'             => 'GET',
		'callback'            => function () {
			$idx      = wsbot_index();
			$provider = wsbot_opt( 'provider', 'gemini' );
			$keys     = (array) wsbot_opt( 'keys', array() );
			return array(
				'ok'        => (bool) $idx,
				'chunks'    => $idx ? count( $idx['docs'] ) : 0,
				'synced'    => $idx['generated'] ?? '',
				'provider'  => $provider,
				'key_set'   => ! empty( $keys[ $provider ] ),
				'enabled'   => (bool) wsbot_opt( 'enabled', 0 ),
			);
		},
		'permission_callback' => '__return_true',
	) );
} );

function wsbot_err( $msg, $code ) {
	return new WP_REST_Response( array( 'error' => $msg ), $code );
}

function wsbot_chat( WP_REST_Request $req ) {
	// only accept calls from this site
	$site   = wp_parse_url( home_url(), PHP_URL_HOST );
	$from   = $req->get_header( 'origin' ) ?: $req->get_header( 'referer' );
	$fromh  = $from ? wp_parse_url( $from, PHP_URL_HOST ) : '';
	$strip  = function ( $h ) { return preg_replace( '/^www\./', '', (string) $h ); };
	if ( ! $fromh || $strip( $fromh ) !== $strip( $site ) ) {
		return wsbot_err( 'Not allowed.', 403 );
	}

	$provider  = wsbot_opt( 'provider', 'gemini' );
	$providers = wsbot_providers();
	$keys      = (array) wsbot_opt( 'keys', array() );
	$key       = $keys[ $provider ] ?? '';
	if ( ! $key || ! isset( $providers[ $provider ] ) ) {
		return wsbot_err( 'Chat is not set up yet.', 500 );
	}

	// rate limit: 20 messages per IP per 10 minutes
	$ip   = sanitize_text_field( $_SERVER['REMOTE_ADDR'] ?? 'x' );
	$rk   = 'wsbot_rl_' . md5( $ip );
	$hits = (int) get_transient( $rk );
	if ( $hits >= 20 ) {
		return wsbot_err( 'Too many messages. Please wait a few minutes.', 429 );
	}
	set_transient( $rk, $hits + 1, 10 * MINUTE_IN_SECONDS );

	$message = trim( mb_substr( (string) $req->get_param( 'message' ), 0, 600 ) );
	if ( '' === $message ) {
		return wsbot_err( 'Empty message.', 400 );
	}
	$history = array();
	foreach ( array_slice( (array) $req->get_param( 'history' ), -6 ) as $m ) {
		if ( is_array( $m ) && in_array( $m['role'] ?? '', array( 'user', 'assistant' ), true ) ) {
			$history[] = array( 'role' => $m['role'], 'content' => mb_substr( (string) ( $m['content'] ?? '' ), 0, 1200 ) );
		}
	}

	$idx = wsbot_index();
	if ( ! $idx ) {
		return wsbot_err( 'Knowledge not available right now.', 503 );
	}
	$last = '';
	foreach ( $history as $m ) {
		if ( 'user' === $m['role'] ) {
			$last = $m['content'];
		}
	}
	$sources  = wsbot_search( $idx, $message . ' ' . $last );
	$messages = array_merge(
		array( array( 'role' => 'system', 'content' => wsbot_system_prompt( $sources ) ) ),
		$history,
		array( array( 'role' => 'user', 'content' => $message ) )
	);

	$models = array_filter( array_map( 'trim', explode( ',', wsbot_opt( 'models', $providers[ $provider ]['models'] ) ) ) );
	foreach ( $models as $model ) {
		$res = wp_remote_post( $providers[ $provider ]['url'], array(
			'timeout' => 25,
			'headers' => array(
				'Authorization' => 'Bearer ' . $key,
				'Content-Type'  => 'application/json',
				'HTTP-Referer'  => home_url(),
				'X-Title'       => 'Worksmarto Assistant',
			),
			'body'    => wp_json_encode( array( 'model' => $model, 'messages' => $messages, 'temperature' => 0.3, 'max_tokens' => 800 ) ),
		) );
		if ( is_wp_error( $res ) || 200 !== wp_remote_retrieve_response_code( $res ) ) {
			continue; // try the next model
		}
		$j     = json_decode( wp_remote_retrieve_body( $res ), true );
		$reply = trim( (string) ( $j['choices'][0]['message']['content'] ?? '' ) );
		if ( '' !== $reply ) {
			return new WP_REST_Response( array( 'reply' => $reply, 'model' => $model ), 200 );
		}
	}
	return wsbot_err( 'AI is busy right now. Please try again in a minute.', 503 );
}

/* ---------------- Widget in the footer ---------------- */

add_action( 'wp_footer', function () {
	if ( is_admin() || ! wsbot_opt( 'enabled', 0 ) ) {
		return;
	}
	$keys = (array) wsbot_opt( 'keys', array() );
	if ( empty( $keys[ wsbot_opt( 'provider', 'gemini' ) ] ) ) {
		return; // no key yet: keep the bubble hidden
	}
	printf(
		'<script src="%s" data-api="%s" data-color="%s" data-position="left" defer></script>',
		esc_url( WSBOT_WIDGET_URL ),
		esc_url( untrailingslashit( rest_url( 'wsbot/v1' ) ) ),
		esc_attr( wsbot_opt( 'color', '#4f46e5' ) )
	);
} );
