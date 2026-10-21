<?php
declare(strict_types=1);
if(!defined('ABSPATH'))exit;

final class Aerion_Google_Merchant
{
    public static function boot(): void
    {
        add_action('init',[self::class,'register_rewrite']);
        add_filter('query_vars',static function(array $vars):array{$vars[]='aerion_merchant_feed';return$vars;});
        add_action('template_redirect',[self::class,'render']);
    }
    public static function register_rewrite(): void
    {
        add_rewrite_rule('^loja/google-merchant\\.xml/?$','index.php?aerion_merchant_feed=1','top');
    }

    public static function brand($product): string
    {
        $terms = wp_get_post_terms($product->get_id(), 'product_brand', ['fields' => 'names']);
        if (!is_wp_error($terms) && !empty($terms)) return (string) $terms[0];
        $attribute = trim((string) $product->get_attribute('pa_marca'));
        if ($attribute !== '') return $attribute;
        $name = $product->get_name() . ' ' . $product->get_sku();
        if (preg_match('/\bhubsan\b/i', $name)) return 'HUBSAN';
        if (preg_match('/\bautel\b/i', $name)) return 'Autel Robotics';
        return '';
    }
    public static function render(): void
    {
        if(!get_query_var('aerion_merchant_feed'))return;
        nocache_headers();header('Content-Type: application/xml; charset=UTF-8');
        echo self::xml();exit;
    }

    /**
     * O feed e sempre o preco do consumidor, no cartao.
     *
     * Antes ele usava o preco de quem abrisse a URL: um parceiro logado exportaria
     * a tabela de revenda para o Google. O Pix nao vai para o feed porque depende
     * da forma de pagamento; o preco de lista e o do cartao e a campanha vira
     * `sale_price`.
     */
    public static function xml(): string
    {
        $user=get_current_user_id();
        wp_set_current_user(0);
        try{
            $out="<?xml version='1.0' encoding='UTF-8'?><rss xmlns:g='http://base.google.com/ns/1.0' version='2.0'><channel><title>".esc_xml(get_bloginfo('name')).' — Loja</title><link>'.esc_xml(wc_get_page_permalink('shop')).'</link><description>Produtos Autel oficiais no Brasil</description>';
            foreach(wc_get_products(['status'=>'publish','limit'=>-1,'orderby'=>'id'])as$p){
                if((float)$p->get_regular_price()<=0||$p->get_meta('_aerion_shipping_validated',true)!=='yes')continue;
                $quote=Aerion_Pricing::quote($p,'consumer',0);
                $regular=$quote['list_card'];$current=$quote['card'];
                $gtin=preg_replace('/\\D/','',(string)$p->get_meta('_aerion_gtin',true));
                $out.='<item><g:id>'.esc_xml($p->get_sku()).'</g:id><g:title>'.esc_xml($p->get_name()).'</g:title><g:description>'.esc_xml(wp_strip_all_tags($p->get_short_description()?:$p->get_description())).'</g:description><g:link>'.esc_xml($p->get_permalink()).'</g:link><g:image_link>'.esc_xml(wp_get_attachment_image_url($p->get_image_id(),'full')?:wc_placeholder_img_src()).'</g:image_link><g:condition>new</g:condition><g:availability>'.($p->is_in_stock()?'in_stock':'out_of_stock').'</g:availability><g:price>'.esc_xml(wc_format_decimal($regular,2).' BRL').'</g:price>';
                if($current>0&&$current<$regular)$out.='<g:sale_price>'.esc_xml(wc_format_decimal($current,2).' BRL').'</g:sale_price>';
                $brand = self::brand($p);
                if ($brand !== '') $out.='<g:brand>'.esc_xml($brand).'</g:brand>';
                $out.=$gtin?'<g:gtin>'.esc_xml($gtin).'</g:gtin>':'<g:mpn>'.esc_xml((string)($p->get_meta('_aerion_mpn',true)?:$p->get_sku())).'</g:mpn>';
                $out.='<g:identifier_exists>true</g:identifier_exists></item>';
            }
            return$out.'</channel></rss>';
        }finally{
            wp_set_current_user($user);
        }
    }
}
