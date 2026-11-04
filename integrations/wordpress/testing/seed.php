<?php
if (getenv('AERION_READINESS_TEST') !== '1') { exit(99); }
$installing=!is_file('/var/www/html/.readiness-installed');if($installing)define('WP_INSTALLING',true);$_SERVER['HTTP_HOST']='127.0.0.1:18084';$_SERVER['REQUEST_URI']='/';
require '/var/www/html/wp-load.php';require_once ABSPATH.'wp-admin/includes/upgrade.php';require_once ABSPATH.'wp-admin/includes/plugin.php';
if (!is_blog_installed()) wp_install('Aerion — isolated checkout tests','readiness_admin','readiness@example.invalid',false,'',bin2hex(random_bytes(24)));
if($installing){file_put_contents('/var/www/html/.readiness-installed','ready');echo json_encode(['retry_seed'=>true]);return;}
update_option('blog_public',0);update_option('timezone_string','America/Sao_Paulo');update_option('WPLANG','pt_BR');
update_option('gtm4wp-options',array_merge((array)get_option('gtm4wp-options',[]),['gtm-code'=>'GTM-5G8QBHHC','gtm-code-in-footer'=>false]));
foreach (['woocommerce/woocommerce.php','wp-consent-api/wp-consent-api.php','gdpr-cookie-compliance/moove-gdpr.php','duracelltomi-google-tag-manager/duracelltomi-google-tag-manager-for-wordpress.php','aerion-core/aerion-core.php','aerion-commerce/aerion-commerce.php','aerion-blocks/aerion-blocks.php','aerion-ecommerce-reports/aerion-ecommerce-reports.php'] as $plugin) {
    $result=activate_plugin($plugin);if (is_wp_error($result)) throw new RuntimeException('Cannot activate '.$plugin);
}
if(!class_exists('WC_Install'))require_once WP_PLUGIN_DIR.'/woocommerce/includes/class-wc-install.php';
WC_Install::install();WC_Install::create_pages();switch_theme('aerion');update_option('woocommerce_currency','BRL');update_option('woocommerce_default_country','BR:SP');update_option('woocommerce_calc_taxes','no');update_option('woocommerce_enable_guest_checkout','yes');
$product_id=(int)get_option('aerion_readiness_product');$product=$product_id?wc_get_product($product_id):new WC_Product_Simple();
$product->set_name('Produto sintético para validação');$product->set_sku('AERION-TEST-ONLY');$product->set_status('publish');$product->set_regular_price('100.00');$product->set_price('100.00');$product->set_manage_stock(true);$product->set_stock_quantity(100);$product->set_weight('1');$product->set_length('10');$product->set_width('10');$product->set_height('10');$product->set_description('Dados sintéticos exclusivos do ambiente isolado de testes.');$product->save();update_option('aerion_readiness_product',$product->get_id());
$checkout_id=wc_get_page_id('checkout');wp_update_post(['ID'=>$checkout_id,'post_content'=>'[woocommerce_checkout]']);
$cart_id=wc_get_page_id('cart');wp_update_post(['ID'=>$cart_id,'post_content'=>'[woocommerce_cart]']);
$shop_id=wc_get_page_id('shop');wp_update_post(['ID'=>$shop_id,'post_name'=>'loja','post_content'=>'<!-- wp:aerion/storefront /-->']);
$zone=new WC_Shipping_Zone(0);if (!$zone->get_shipping_methods()) {$method_id=$zone->add_shipping_method('flat_rate');update_option('woocommerce_flat_rate_'.$method_id.'_settings',['enabled'=>'yes','title'=>'Frete simulado','cost'=>'10']);}
update_option('permalink_structure','/%postname%/');flush_rewrite_rules();
echo json_encode(['isolated'=>true,'product_id'=>$product->get_id(),'product_url'=>get_permalink($product->get_id()),'cart'=>wc_get_cart_url(),'checkout'=>wc_get_checkout_url(),'gateway'=>'aerion_readiness','external_calls'=>'blocked','mail'=>'suppressed']);
