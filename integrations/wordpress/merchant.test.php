<?php
declare(strict_types=1);
define('ABSPATH', '/tmp/');
function wp_get_post_terms(mixed ...$args): array { return []; }
function is_wp_error(mixed $value): bool { return false; }
function wp_timezone(): DateTimeZone { return new DateTimeZone('America/Sao_Paulo'); }
function wp_date(string $format): string { return '2026-10-21'; }
class Aerion_Presale { public static function active(Product $product): bool { return $product->presale; } }
require __DIR__ . '/class-aerion-google-merchant.php';
class Product {
    public function __construct(private string $name, private string $sku = '', private string $brand = '', public bool $presale = false, public string $date = '') {}
    public function get_id(): int { return 1; }
    public function get_name(): string { return $this->name; }
    public function get_sku(): string { return $this->sku; }
    public function get_attribute(string $name): string { return $this->brand; }
    public function get_meta(string $name, bool $single): string { return $name === '_aerion_presale_date' ? $this->date : ''; }
    public function is_on_backorder(int $quantity): bool { return false; }
    public function is_in_stock(): bool { return true; }
    public function is_virtual(): bool { return false; }
    public function get_weight(): string { return '1'; }
    public function get_length(): string { return '20'; }
    public function get_width(): string { return '10'; }
    public function get_height(): string { return '5'; }
}
foreach ([['HUBSAN Mini 7', 'HUBSAN'], ['Autel Mapper', 'Autel Robotics'], ['Generic accessory', '']] as [$name, $brand]) {
    if (Aerion_Google_Merchant::brand(new Product($name)) !== $brand) throw new RuntimeException('Incorrect manufacturer brand: '.$name);
}
if (Aerion_Google_Merchant::brand(new Product('Other product', '', 'Manufacturer')) !== 'Manufacturer') throw new RuntimeException('Explicit brand must win.');
$preorder = Aerion_Google_Merchant::availability(new Product('Mini 7', '', '', true, '2027-02-05'));
if ($preorder !== ['status' => 'preorder', 'date' => '2027-02-05T00:00:00-03:00']) throw new RuntimeException('Preorder must include its real shipping date.');
if (Aerion_Google_Merchant::availability(new Product('Undated', '', '', true)) !== null) throw new RuntimeException('Do not list undated preorder as in stock.');
if (Aerion_Google_Merchant::availability(new Product('Invalid', '', '', true, '2027-02-30')) !== null) throw new RuntimeException('Shipping dates must be valid.');
if (!Aerion_Google_Merchant::shipping_ready(new Product('Measured kit'))) throw new RuntimeException('Current shipping measurements, not the stale import flag, control eligibility.');
if (Aerion_Google_Merchant::shipping_ready(new class('No weight') extends Product { public function get_weight(): string { return ''; } })) throw new RuntimeException('Incomplete physical shipment must not be listed.');
if (!Aerion_Google_Merchant::shipping_ready(new class('Software') extends Product { public function is_virtual(): bool { return true; } public function get_weight(): string { return ''; } })) throw new RuntimeException('Digital products do not require a physical parcel.');
echo "Merchant brand tests passed.\n";
