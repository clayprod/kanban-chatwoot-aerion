<?php
declare(strict_types=1);
define('ABSPATH', '/tmp/');
function wp_get_post_terms(mixed ...$args): array { return []; }
function is_wp_error(mixed $value): bool { return false; }
require __DIR__ . '/class-aerion-google-merchant.php';
class Product {
    public function __construct(private string $name, private string $sku = '', private string $brand = '') {}
    public function get_id(): int { return 1; }
    public function get_name(): string { return $this->name; }
    public function get_sku(): string { return $this->sku; }
    public function get_attribute(string $name): string { return $this->brand; }
}
foreach ([['HUBSAN Mini 7', 'HUBSAN'], ['Autel Mapper', 'Autel Robotics'], ['Generic accessory', '']] as [$name, $brand]) {
    if (Aerion_Google_Merchant::brand(new Product($name)) !== $brand) throw new RuntimeException('Incorrect manufacturer brand: '.$name);
}
if (Aerion_Google_Merchant::brand(new Product('Other product', '', 'Manufacturer')) !== 'Manufacturer') throw new RuntimeException('Explicit brand must win.');
echo "Merchant brand tests passed.\n";
