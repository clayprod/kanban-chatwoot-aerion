<?php
declare(strict_types=1);
define('ABSPATH', '/tmp/');
function add_action(mixed ...$args): void {}
function add_filter(mixed ...$args): void {}
function is_order_received_page(): bool { return true; }
function get_query_var(string $key): int { return 123; }
function absint(mixed $value): int { return abs((int) $value); }
function wc_get_order(int $id): WC_Order { global $receipt; return $receipt; }
class WC_Order {
    public function __construct(public bool $paid, public mixed $date) {}
    public function is_paid(): bool { return $this->paid; }
    public function get_date_paid(): mixed { return $this->date; }
    public function get_id(): int { return 123; }
    public function get_currency(): string { return 'BRL'; }
    public function get_fees(): array { return []; }
    public function get_items(string $type): array { return [new class { public function get_total(): string { return '99.95'; } }]; }
}
function check(bool $value, string $message): void { if (! $value) { throw new RuntimeException($message); } }
require __DIR__ . '/measurement.php';
$options = Aerion_Ecommerce_Measurement::options(['gtm-code' => 'GTM-EXISTING']);
check($options['gtm-code'] === 'GTM-EXISTING', 'Preserve existing container.');
check($options['integrate-woocommerce-remarketing-usesku'] === true, 'Product IDs must match SKU feed.');
check($options['integrate-woocommerce-customer-data'] === false && $options['integrate-woocommerce-order-data'] === false, 'Do not publish customer PII.');
$consent = Aerion_Ecommerce_Measurement::consent_options([]);
check($consent['moove_gdpr_third_party_cookies_enable'] === 1 && $consent['moove_gdpr_advanced_cookies_enable'] === 1, 'Visitors need separate statistics and advertising choices.');
check($consent['moove_gdpr_third_party_cookies_enable_first_visit'] === 0 && $consent['moove_gdpr_advanced_cookies_enable_first_visit'] === 0, 'Optional tracking stays off until the visitor opts in.');
check(Aerion_Ecommerce_Measurement::consent_pre_options(false) === false, 'Do not short circuit WordPress when Moove did not supply settings.');
check(Aerion_Ecommerce_Measurement::consent_pre_options(['existing' => 'value'])['moove_gdpr_third_party_cookies_enable'] === 1, 'Apply policy after Moove own-table pre_option callback.');
foreach ([[false, null], [true, null], [false, 'paid-date']] as [$paid, $date]) {
    $receipt = new WC_Order($paid, $date);
    $gtm4wp_options = $options;
    Aerion_Ecommerce_Measurement::guard_unpaid_page();
    check($gtm4wp_options['integrate-woocommerce-track-enhanced-ecommerce'] === false, 'Pending receipts must not be marked tracked.');
    check(Aerion_Ecommerce_Measurement::purchase([], $receipt)['event'] !== 'purchase', 'Unpaid orders cannot be purchases.');
}
$receipt = new WC_Order(true, 'paid-date');
$gtm4wp_options = $options;
Aerion_Ecommerce_Measurement::guard_unpaid_page();
check($gtm4wp_options['integrate-woocommerce-track-enhanced-ecommerce'] === true, 'Paid receipts retain ecommerce output.');
$purchase = Aerion_Ecommerce_Measurement::purchase(['ecommerce' => ['value' => 150, 'items' => [['item_id' => 'SKU']]]], $receipt);
check($purchase['ecommerce']['value'] === 99.95, 'Value excludes shipping, taxes and fees.');
check($purchase['ecommerce']['transaction_id'] === '123', 'Stable internal order ID deduplicates purchases.');
check($purchase['event_id'] === 'aerion_purchase_123', 'Browser/server share a deterministic event ID.');
check($purchase['ecommerce']['items'][0]['item_id'] === 'SKU', 'Preserve item details.');
$pix = new class(true, 'paid-date') extends WC_Order {
    public function get_fees(): array { return [new class {
        public function get_name(): string { return 'Desconto no Pix'; }
        public function get_total(): string { return '-5'; }
    }]; }
};
$purchase = Aerion_Ecommerce_Measurement::purchase(['ecommerce' => ['items' => [['item_id' => 'SKU', 'price' => 99.95, 'quantity' => 1]]]], $pix);
check($purchase['ecommerce']['value'] === 94.95 && $purchase['ecommerce']['items'][0]['price'] === 94.95, 'Pix payment discount must reduce purchase value and item prices.');
echo "WordPress measurement tests passed.\n";
