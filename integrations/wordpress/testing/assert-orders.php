<?php
if(getenv('AERION_READINESS_TEST')!=='1')exit(99);
define('WP_USE_THEMES',false);$_SERVER['HTTP_HOST']='127.0.0.1:18084';$_SERVER['REQUEST_URI']='/';require '/var/www/html/wp-load.php';
$out=[];foreach(wc_get_orders(['limit'=>20,'orderby'=>'id','order'=>'DESC','payment_method'=>'aerion_readiness'])as$order){$context=$order->get_meta('_aerion_measurement_context');$out[]=['id'=>$order->get_id(),'status'=>$order->get_status(),'paid'=>(bool)$order->get_date_paid(),'total'=>$order->get_total(),'shipping'=>$order->get_shipping_total(),'test'=>$order->get_meta('_aerion_readiness_test'),'measurement_context'=>is_array($context)?['statistics'=>$context['statistics']??null,'marketing'=>$context['marketing']??null,'has_client_id'=>!empty($context['clientId'])]:null];}echo json_encode($out);
