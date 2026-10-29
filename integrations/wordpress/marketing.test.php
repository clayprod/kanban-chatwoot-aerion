<?php
declare(strict_types=1);
define('ABSPATH', '/tmp/');
$routes = []; $user = 42; $products = []; $allowed = false; $failQuote = false; $metadata = []; $modified = '2026-10-29T12:00:00-03:00'; $writes = 0;
function add_action(mixed ...$args): void {}
function add_filter(mixed ...$args): void {}
function register_rest_route(string $ns, string $path, array $args): void { global $routes; $routes[$path] = $args; }
function current_user_can(string $cap): bool { global $allowed; return $allowed && $cap === 'aerion_read_reports'; }
function get_current_user_id(): int { global $user; return $user; }
function wp_set_current_user(int $id): void { global $user; $user = $id; }
function wc_get_products(array $args): array { global $products; return $products; }
function wc_get_product(int $id): mixed { global $products; foreach ($products as $p) if ($p->get_id() === $id) return $p; return null; }
function wp_get_post_terms(int $id, string $type, array $args): array { return $type === 'product_cat' ? ['Drones'] : ['HUBSAN']; }
function is_wp_error(mixed $value): bool { return false; }
function wp_strip_all_tags(string $value): string { return strip_tags($value); }
function wp_get_attachment_image_url(int $id, string $size): string|false { return $id ? 'https://loja.aerion.com.br/photo.jpg' : false; }
function get_woocommerce_currency(): string { return 'BRL'; }
function wp_timezone(): DateTimeZone { return new DateTimeZone('America/Sao_Paulo'); }
function get_post_meta(int $id, string $key, bool $single): mixed { global $metadata; return $metadata[$id][$key] ?? ''; }
function update_post_meta(int $id, string $key, mixed $value): void { global $metadata; $metadata[$id][$key] = $value; }
function delete_post_meta(int $id, string $key): void { global $metadata; unset($metadata[$id][$key]); }
function wp_update_post(array $post, bool $error): int { global $modified, $writes; $writes++; $modified = (new DateTimeImmutable($modified))->modify('+1 second')->format(DATE_ATOM); return $post['ID']; }
class WP_REST_Request extends ArrayObject {}
class WP_REST_Response {
    public array $headers = [];
    public function __construct(public array $data) {}
    public function header(string $key, string $value): void { $this->headers[$key] = $value; }
}
class WP_Error { public function __construct(public string $code, public string $message, public array $data) {} }
class Product {
    public function __construct(private int $id = 1, public int $image = 1, public string $sku = 'SKU-1', public string $date = '') {}
    public function get_id(): int { return $this->id; }
    public function get_parent_id(): int { return 0; }
    public function get_sku(): string { return $this->sku; }
    public function get_name(): string { return 'HUBSAN Mini'; }
    public function get_meta(string $key, bool $single): string { return $key === '_aerion_presale_date' ? $this->date : ''; }
    public function get_attribute(string $key): string { return ''; }
    public function get_short_description(): string { return 'Descrição real'; }
    public function get_description(): string { return ''; }
    public function get_permalink(): string { return 'https://loja.aerion.com.br/drone/'; }
    public function get_image_id(): int { return $this->image; }
    public function is_on_backorder(int $n): bool { return $this->date !== ''; }
    public function is_in_stock(): bool { return true; }
    public function get_status(): string { return 'publish'; }
    public function get_catalog_visibility(): string { return 'visible'; }
    public function get_date_modified(): mixed { return new class { public function date(string $format): string { global $modified; return $modified; } }; }
    public function is_type(string $type): bool { return false; }
}
class Aerion_Pricing {
    public static function quote(mixed $product, string $type, int $id): array {
        global $failQuote;
        if ($failQuote) throw new RuntimeException('quote failed');
        if (get_current_user_id() !== 0 || $type !== 'consumer' || $id !== 0) throw new RuntimeException('Private price access');
        return ['card' => 100, 'list_card' => 120, 'wholesale' => 50];
    }
}
function check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
require __DIR__ . '/marketing.php';
Aerion_Marketing_Products::register();
check(!$routes['/marketing-products']['permission_callback'](), 'Anonymous marketing access is forbidden');
$allowed = true;
check($routes['/marketing-products']['permission_callback'](), 'Report reader can read public products');
check(!$routes['/marketing-audience-customers']['permission_callback'](), 'PII requires a separate sync capability');
$products = [new Product()];
$request = new WP_REST_Request(['page' => 1, 'per_page' => 100, 'product_id' => 0]);
$result = Aerion_Marketing_Products::products($request);
check($user === 42, 'Restore authenticated user after public quotation');
check($result->data['products'][0]['consumer_price'] === 100, 'Export only consumer card price');
check(!str_contains(json_encode($result->data), 'wholesale'), 'Do not export wholesale metadata');
check($result->headers['Cache-Control'] === 'private, no-store', 'Never publicly cache privileged API responses');
$products = [new Product(image: 0, date: '2027-02-30')];
$p = Aerion_Marketing_Products::products($request)->data['products'][0];
check($p['image'] === '' && $p['availability_date'] === null, 'Do not invent image or invalid date');
$failQuote = true;
try { Aerion_Marketing_Products::products($request); } catch (RuntimeException) {}
check($user === 42, 'Restore user after quote failure');
$failQuote = false; $products = [new Product()];
$seo = new WP_REST_Request(['product_id' => 1, 'title' => 'Título aprovado', 'description' => 'Descrição aprovada', 'content_id' => '11111111-1111-4111-8111-111111111111', 'expected_modified_at' => $modified]);
check(Aerion_Marketing_Products::publish_seo($seo) instanceof WP_Error, 'SEO output requires an audited renderer before publication');
define('AERION_APPROVED_SEO_OUTPUT', true);
$published = Aerion_Marketing_Products::publish_seo($seo);
check($published instanceof WP_REST_Response && $published->data['published'] === true, 'Explicitly approved SEO can publish');
check(Aerion_Marketing_Products::publish_seo($seo) instanceof WP_REST_Response && $writes === 1, 'Publication retries must be idempotent');
$modified = (new DateTimeImmutable($modified))->modify('+1 minute')->format(DATE_ATOM);
$conflict = Aerion_Marketing_Products::publish_seo($seo);
check($conflict instanceof WP_Error && $conflict->data['status'] === 409, 'Concurrent product edits block replay of obsolete SEO');
echo "Marketing consumer projection tests passed.\n";
