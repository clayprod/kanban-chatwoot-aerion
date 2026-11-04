<?php
if(getenv('AERION_READINESS_TEST')!=='1')exit(99);
define('WP_USE_THEMES',false);$_SERVER['HTTP_HOST']='127.0.0.1:18084';$_SERVER['REQUEST_URI']='/loja/';require '/var/www/html/wp-load.php';
$original=[];$created=[];$results=[];
function reset_campaign_test_cache():void{(new ReflectionProperty(Aerion_Campaigns::class,'cache'))->setValue(null,[]);}
function campaign_test_create(string$title,array$products,int$priority,bool$featured):int{$id=wp_insert_post(['post_type'=>'aerion_campaign','post_status'=>'publish','post_title'=>$title]);foreach(['start'=>wp_date('Y-m-d\TH:i:s',time()-86400),'end'=>wp_date('Y-m-d\TH:i:s',time()+86400),'priority'=>$priority,'audience'=>'consumer','type'=>'percentage','percentage'=>10,'products'=>$products,'featured'=>$featured?'yes':'no']as$key=>$value)update_post_meta($id,'_aerion_campaign_'.$key,$value);return$id;}
try{
 foreach(get_posts(['post_type'=>'aerion_campaign','post_status'=>'publish','numberposts'=>-1])as$p){$original[]=$p->ID;wp_update_post(['ID'=>$p->ID,'post_status'=>'draft']);}
 $product=new WC_Product_Simple();$product->set_name('Segundo produto sintético');$product->set_sku('AERION-HEADING-TEST');$product->set_regular_price('150');$product->set_price('150');$product->set_stock_status('instock');$product->set_status('publish');$product->save();
 $main=campaign_test_create('Black November',[275,$product->get_id()],10,true);$created[]=$main;
 $exception=campaign_test_create('Oferta específica de um SKU',[$product->get_id()],20,false);$created[]=$exception;
 foreach(['Black November','Campanha de Dezembro']as$title){wp_update_post(['ID'=>$main,'post_title'=>$title]);reset_campaign_test_cache();$html=aerion_render_storefront_block([]);if(!preg_match('/<header class="aerion-store-heading aerion-store-heading--offers">(.*?)<\/header>/s',$html,$match))throw new RuntimeException('Offers heading missing');if(!str_contains($match[1],esc_html($title))||!str_contains($match[1],'<a href="')||!str_contains($match[1],'text-decoration:none'))throw new RuntimeException('Campaign title, link or text appearance incorrect');$results[]=['title'=>$title,'campaign_link'=>true,'text_appearance'=>true,'sku_exception_preserved'=>true];}
 foreach($created as$id)wp_update_post(['ID'=>$id,'post_status'=>'draft']);reset_campaign_test_cache();$html=aerion_render_storefront_block([]);if(!str_contains($html,'<h2>Produtos em destaque</h2>'))throw new RuntimeException('Fallback heading missing');$results[]=['title'=>'Produtos em destaque','no_campaign'=>true];
 echo json_encode(['passed'=>true,'cases'=>$results]);
}finally{foreach($created as$id)wp_delete_post($id,true);foreach($original as$id)wp_update_post(['ID'=>$id,'post_status'=>'publish']);if(isset($product))$product->delete(true);}
