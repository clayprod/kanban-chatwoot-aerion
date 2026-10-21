<?php
declare(strict_types=1);
define('ABSPATH', '/tmp/');
define('ARRAY_A', 'ARRAY_A');
define('DAY_IN_SECONDS', 86400);
class WP_REST_Server { public const READABLE = 'GET'; }
class WP_REST_Response {
    public array $headers = [];
    public function __construct(public array $data) {}
    public function header(string $key, string $value): void { $this->headers[$key] = $value; }
}
class WP_Error { public function __construct(public string $code, public string $message, public array $data) {} }
class WP_REST_Request extends ArrayObject { public function get_param(string $key): mixed { return $this[$key] ?? null; } }
class Aerion_UTM_Analytics {}
class FakeDb {
    public string $prefix = 'wp_';
    public string $last_error = '';
    public array $rows = [];
    public function prepare(string $sql, mixed ...$values): string { return $sql; }
    public function get_results(string $sql, string $format): array { return $this->rows; }
}
$wpdb = new FakeDb();
$routes = [];
$allowed = false;
function register_activation_hook(mixed ...$args): void {}
function add_action(mixed ...$args): void {}
function add_role(mixed ...$args): void {}
function current_user_can(string $cap): bool { global $allowed; return $cap === 'aerion_read_reports' && $allowed; }
function wp_timezone_string(): string { return 'America/Sao_Paulo'; }
function register_rest_route(string $namespace, string $path, array $args): void { global $routes; $routes[$path] = $args; }
function check(bool $condition, string $message): void { if (! $condition) { throw new RuntimeException($message); } }
require __DIR__ . '/aerion-ecommerce-reports.php';
Aerion_Ecommerce_Reports::register();
check(count($routes) === 3, 'Expected three read-only routes.');
foreach ($routes as $route) {
    check($route['methods'] === 'GET', 'Mutation route is not allowed.');
    check($route['permission_callback']() === false, 'Anonymous access must be denied.');
}
$allowed = true;
check($routes['/health']['permission_callback'](), 'Report capability should grant access.');
check(Aerion_Ecommerce_Reports::health()->headers['Cache-Control'] === 'private, no-store, max-age=0', 'Reports cannot be public-cached.');
$wpdb->rows = [['link_id' => 'abc', 'coupon_codes' => '["aerion"]']];
$links = Aerion_Ecommerce_Reports::links(new WP_REST_Request(['page' => 1, 'per_page' => 100]));
check($links->data[0]['coupon_codes'] === ['aerion'], 'Coupon list should decode.');
$wpdb->rows = [['link_id' => 'abc', 'date' => '2026-10-20', 'visitors' => '3', 'landings' => '5']];
$visits = Aerion_Ecommerce_Reports::visits(new WP_REST_Request(['page' => 1, 'per_page' => 100, 'from' => '2026-10-01', 'to' => '2026-10-21']));
check($visits->data[0]['visitors'] === 3 && $visits->data[0]['landings'] === 5, 'Aggregates must be numeric.');
check(! isset($visits->data[0]['session_hash']), 'Session identifiers must not be exposed.');
$invalid = Aerion_Ecommerce_Reports::visits(new WP_REST_Request(['page' => 1, 'per_page' => 100, 'from' => '2026-02-30', 'to' => '2026-10-21']));
check($invalid instanceof WP_Error && $invalid->data['status'] === 400, 'Invalid dates must fail.');
$wpdb->last_error = 'sensitive internal database error';
$failed = Aerion_Ecommerce_Reports::links(new WP_REST_Request(['page' => 1, 'per_page' => 100]));
check($failed instanceof WP_Error && ! str_contains($failed->message, 'sensitive'), 'Database errors must be sanitized.');
echo "WordPress report tests passed.\n";
