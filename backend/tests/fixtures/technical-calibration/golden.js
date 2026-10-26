'use strict';
const {literalEvidenceQuote}=require('../../../technicalExtraction');
// Reviewed against the original pages, independently of paid model responses.
// These rows are acceptance data, never rules for production extraction.
const row=(anchor,key,value,unit='',operator='eq',component='',category='equipment')=>({anchor,key,value,unit,operator,component,category});
const arce=[
 row('PROFISSIONAL','professional_use','PROFISSIONAL'),row('LONGO ALCANCE','long_range','LONGO ALCANCE'),
 row('CAMERA 5.1K OU SUPERIOR','video_resolution','5.1K','','min','wide_camera'),row('5.8 GHZ','control_frequency',5.8,'GHz','eq','controller'),
 row('03 BATERIAS RESERVAS','battery_quantity_reserve',3,'baterias','eq','battery','kit'),row('GPS','gnss_systems','GPS'),row('WI FI','wifi','WI FI'),row('BLUETOOTH','bluetooth','BLUETOOTH'),
 row('Câmera visual 3 eixos','gimbal_axes',3,'eixos'),row('zoom =30x','zoom_unspecified',30,'x','eq','wide_camera'),
 row('térmica 640x512 radiométrica','thermal_resolution','640x512','','eq','thermal_camera'),row('térmica 640x512 radiométrica','thermal_camera_type','radiométrica','','eq','thermal_camera'),
 row('GNSS','gnss_systems','GNSS'),row('RTH','return_to_home','RTH'),row('autonomia =40 min','flight_time',40,'min'),row('vento =12 m/s','wind_resistance',12,'m/s'),
 row('hub de carga','battery_charging_hub','hub de carga','','eq','charger','kit'),
 row('drone novo','equipment_condition','novo'),row('garantia mínima de 12 meses','warranty',12,'meses','min','','supply'),
];
const saoGoncalo=[
 row('DRONE PORTÁTIL','equipment_portability','PORTÁTIL'),row('CÂMERA DE ALTO DESEMPENHO','camera_performance','ALTO DESEMPENHO','','eq','wide_camera'),
 row('CONTROLE REMOTO COM TELA INTEGRADA','controller_screen','TELA INTEGRADA','','eq','controller'),
 row('TRÊS BATERIAS DE AUTONOMIA','battery_quantity',3,'baterias','eq','battery','kit'),row('KIT COMPLETO DE ACESSÓRIOS','kit_accessories','KIT COMPLETO DE ACESSÓRIOS','','eq','','kit'),
 row('NOVO E DE PRIMEIRO USO','equipment_condition','NOVO E DE PRIMEIRO USO'),
 row('DJI MINI 5 PRO FLY MORE COMBO PLUS COM DJI RC','reference_model','DJI MINI 5 PRO FLY MORE COMBO PLUS COM DJI RC','','eq','','administrative'),
];
const mg34=[
 row('tipo multirrotor','aircraft_type','multirrotor'),row('Até 730 g','takeoff_weight',730,'g','max'),
 row('214,19 × 100,63 × 89,17 mm','folded_dimensions','214,19 × 100,63 × 89,17 mm'),row('266,11 × 325,47 × 106 mm','unfolded_dimensions','266,11 × 325,47 × 106 mm'),
 row('GPS; Galileo; BeiDou','gnss_systems','GPS; Galileo; BeiDou'),
 row('Vertical: ±0,1 m (sistema visual)','hover_accuracy_vertical_visual',0.1,'m'),row('Vertical: ±0,1 m (sistema visual) / ±0,5 m (satélite)','hover_accuracy_vertical_satellite',0.5,'m'),
 row('Horizontal: ±0,3 m (sistema visual)','hover_accuracy_horizontal_visual',0.3,'m'),row('Horizontal: ±0,3 m (sistema visual) / ±0,5 m (satélite)','hover_accuracy_horizontal_satellite',0.5,'m'),
 row('Ângulo máximo de inclinação: Até 36°','maximum_tilt',36,'°','max'),
 row('Velocidade máxima de ascensão e descensão: Até 10 m/s','ascent_speed',10,'m/s','max'),row('Velocidade máxima de ascensão e descensão: Até 10 m/s','descent_speed',10,'m/s','max'),
 row('Velocidade máxima de voo horizontal: Até 21 m/s (sem vento)','flight_speed',21,'m/s','max'),row('Altura máxima de serviço acima do nível do mar: Até 6.000 m','flight_ceiling',6000,'m','max'),
 row('Resistência máxima ao vento: Até 12 m/s','wind_resistance',12,'m/s','max'),row('Tempo máximo de voo: Até 45 minutos (condições ideais e sem vento)','flight_time',45,'minutos','max'),
 row('Tempo máximo de voo estacionário: Até 41 minutos (condições ideais e sem vento)','hover_time',41,'minutos','max'),row('Distância máxima de voo: Até 32 km','flight_distance',32,'km','max'),
 row('Temperatura de funcionamento: -10 °C a 40 °C','operating_temperature','-10 °C a 40 °C'),row('Capacidade mínima de 42 GB','internal_storage',42,'GB','min'),row('Compatível com cartão microSD','memory_card_support','microSD'),
];
const mg35=[
 row('Sensor CMOS de 1 polegada','camera_sensor','1 polegada','','eq','wide_camera'),row('Resolução efetiva de no mínimo 50 MP','camera_resolution',50,'MP','min','wide_camera'),
 row('FOV aproximado de 84°','lens_fov',84,'°','eq','wide_camera'),row('distância focal de 24 mm','focal_length',24,'mm','eq','wide_camera'),row('abertura f/1.8','lens_aperture','f/1.8','','eq','wide_camera'),row('foco de 0,5 m ao infinito','focus_range','0,5 m ao infinito','','eq','wide_camera'),
 row('Vídeo de 100 a 12.800 (normal)','video_iso_normal','100 a 12.800','','eq','wide_camera'),row('até 51.200 (no-turno)','video_iso_night',51200,'ISO','max','wide_camera'),row('Fotografia de 50 a 6.400 (normal)','photo_iso_normal','50 a 6.400','','eq','wide_camera'),
 row('2 segundos a 1/8.000 segundo','shutter_speed','2 segundos a 1/8.000 segundo','','eq','wide_camera'),row('Até 8.192 × 6.144 pixels','image_size','8.192 × 6.144 pixels','','max','wide_camera'),
 row('Sensor CMOS de 1/1,3 polegada','camera_sensor','1/1,3 polegada','','eq','tele_camera'),row('mínimo 48 MP','camera_resolution',48,'MP','min','tele_camera'),row('FOV de 35°','lens_fov',35,'°','eq','tele_camera'),
 row('distância focal de 70 mm','focal_length',70,'mm','eq','tele_camera'),row('zoom óptico aproximado de 3×','optical_zoom',3,'x','eq','tele_camera'),row('abertura f/2.8','lens_aperture','f/2.8','','eq','tele_camera'),
 row('JPEG; DNG – RAW','photo_formats','JPEG; DNG – RAW'),row('Disparo único; Disparo contínuo; Exposição automática (AEB); Fotografia temporizada; Fotografia panorâmica','photo_modes','Disparo único; Disparo contínuo; Exposição automática (AEB); Fotografia temporizada; Fotografia panorâmica'),
 row('MP4 (Codec H.264/H.265)','video_formats','MP4 (Codec H.264/H.265)'),row('4K em até 120 fps','video_recording_4k','4K em até 120 fps'),row('Full HD em até 240 fps','video_recording_fhd','Full HD em até 240 fps'),
 row('Sistema de detecção omnidirecional de obstáculos','obstacle_sensing','omnidirecional'),row('Sistema visual binocular','obstacle_binocular','visual binocular'),row('Sensor LiDAR frontal','obstacle_lidar','LiDAR frontal'),row('Sensor infravermelho tridimensional inferior','obstacle_infrared','infravermelho tridimensional inferior'),
 row('Ambientes externos com iluminação e condições adequadas ao funcionamento dos sensores visuais','sensor_operating_conditions','Ambientes externos com iluminação e condições adequadas ao funcionamento dos sensores visuais'),
 row('estabilização mecânica triaxial (Inclinação, Rotação e Giro)','gimbal_stabilization','mecânica triaxial (Inclinação, Rotação e Giro)'),row('Aproximadamente -135° a 70°','gimbal_mechanical_tilt','-135° a 70°'),row('Aproximadamente -90° a 60°','gimbal_controllable_tilt','-90° a 60°'),row('Até 100°/s','gimbal_control_speed',100,'°/s','max'),
 row('2,4000 a 2,4835 GHz; 5,170 a 5,250 GHz; 5,725 a 5,850 GHz','transmission_frequencies','2,4000 a 2,4835 GHz; 5,170 a 5,250 GHz; 5,725 a 5,850 GHz'),
 row('Até 20 km em condições ideais, sem obstáculos e sem interferências','transmission_distance',20,'km','max'),row('Até 1080p','transmission_resolution','1080p','','max'),
];
const mg36=[
 row('Tela integrada','controller_screen','Tela integrada','','eq','controller'),row('exibição de telemetria em tempo real','controller_telemetry','telemetria em tempo real','','eq','controller'),row('aplicativo nativo de gerenciamento','controller_application','aplicativo nativo de gerenciamento','','eq','controller'),
 row('armazenamento interno expansível por microSD','controller_storage','expansível por microSD','','eq','controller'),row('bateria interna recarregável','controller_rechargeable_battery','recarregável','','eq','controller'),
 row('Tipo Íons de Lítio (Li-ion)','battery_chemistry','Íons de Lítio (Li-ion)','','eq','battery'),row('capacidade mínima de 4.200 mAh','battery_capacity',4200,'mAh','min','battery'),row('Carregamento sequencial de, no mínimo, três baterias inteligentes','charger_capacity',3,'baterias','min','charger'),
 row('Compartimentos internos sob medida para proteção e transporte de todos os itens do conjunto','case_protection','Compartimentos internos sob medida para proteção e transporte de todos os itens do conjunto','','eq','case','kit'),
 row('Capacidade mínima de 128 GB compatível com a aeronave','memory_card_capacity',128,'GB','min','memory_card','kit'),row('Fornecido em língua portuguesa (Brasil), em formato físico ou digital','manual_language','portuguesa (Brasil)','','eq','','supply'),
 ...[['Aeronave Remotamente Pilotada – RPA','aircraft',1],['Bateria de Voo Inteligente','battery',3],['Bolsa ou Maleta para Transporte','case',1],['Cabos de Conexão','cables',1],['Carregador','charger',1],['Cartão MicroSD de, no mínimo, 128 GB','memory_card',1],['Conjunto de Filtros ND','nd_filters',1],['Controle Remoto Inteligente com tela integrada','controller',1],['Hélices de Reposição','spare_propellers',1],['Hub de Carregamento','charging_hub',1],['Manual de Instruções','manual',1],['Protetor de Gimbal','gimbal_protector',1]].map(([label,key,n])=>row(`${label} ${String(n).padStart(2,'0')}`,`${key}_quantity`,n,'un','eq',key,key==='manual'?'supply':'kit')),
];
const mgShared=[
 row('novos, de primeiro uso','equipment_condition','novos, de primeiro uso'),row('homologação válida pela ANATEL','anatel_certification','homologação válida pela ANATEL'),
];
const mgSafety=[
 row('retorno ao ponto de decolagem (Return to Home - RTH) em caso de perda do enlace de comunicação (link)','return_to_home','Return to Home - RTH'),
 row('autonomia mínima de bateria de 2 (duas) horas','controller_battery_time',2,'horas','min','controller'),row('alcance de transmissão igual ou superior a 6.000 (seis mil) metros','transmission_distance',6000,'metros','min','controller'),
 row('GPS e GLONASS','gnss_systems','GPS e GLONASS'),row('controle remoto dotado de tela integrada','controller_screen','tela integrada','','eq','controller'),
 row('receptor ADS-B','ads_b_receiver','ADS-B'),row('exibir, em mapa digital integrado à estação de pilotagem remota','ads_b_map','mapa digital integrado'),row('sensores posicionados, no mínimo, nas partes frontal, superior e inferior','obstacle_directions','frontal, superior e inferior'),row('manobras automáticas ou assistidas de desvio','obstacle_avoidance','automáticas ou assistidas de desvio'),
];
const supplyGroups=[
 ['52',18,[row('adequado recolhimento das pilhas e baterias originárias da contratação','battery_disposal','adequado recolhimento','','eq','','supply')]],
 ['52',19,[row('no mínimo, 12 (doze) meses','warranty',12,'meses','min','','supply'),row('o fornecedor deverá complementar a garantia do bem ofertado pelo período restante','warranty_complement','complementar a garantia','','eq','','supply'),row('Os prazos serem somados','warranty_additive','somados','','eq','','supply'),row('até 40 (quarenta) dias úteis','delivery_time',40,'dias úteis','max','','supply'),row('entregue em remessa única','delivery_shipment','remessa única','','eq','','supply')].filter(r=>r.key!=='warranty_additive')],
 ['52',20,[row('O descarregamento do produto ficará a cargo do Contratado','unloading','cargo do Contratado','','eq','','supply'),row('substituídos no prazo de até 15 (quinze) dias úteis','replacement_time',15,'dias úteis','max','','supply')]],
 ['52',23,[row('apresentar ficha técnica e/ou portfólio e/ou folder e/ou prospecto','technical_sheet_required','ficha técnica','','eq','','administrative'),row('certificado, número de homologação ou outro meio idôneo','anatel_documentation','número de homologação','','eq','','administrative')]],
 ['52',29,[row('manual do usuário, com uma versão em português','manual_language','português','','eq','','supply'),row('relação da rede de assistência técnica autorizada, se for o caso','technical_assistance','rede de assistência técnica autorizada','','eq','','supply')]],
];
function build(id){
 const notice=require(`./${id}.json`),groups=id==='362510'?[['222',1,arce],['222',4,[row('Prazo para entrega das amostras, em dias úteis: 3','sample_delivery_time',3,'dias úteis','eq','','administrative'),row('Prazo máximo de entrega/início da prestação do serviço, em dias corridos: 20','delivery_time',20,'dias corridos','max','','supply')]]]:id==='362554'?[['225',1,saoGoncalo]]:[['52',16,mgShared],['52',17,mgSafety],['52',34,mg34],['52',35,mg35],['52',36,mg36],...supplyGroups];
 const facts=groups.flatMap(([source_id,page,rows])=>rows.map((r,index)=>{
  const source=notice.sources.find(s=>s.id===source_id),content=source.pages[page-1],quote=literalEvidenceQuote(r.anchor,content.text);
  if(!quote)throw Error(`${id} p${page}: citation not found: ${r.anchor}`);
  return {...r,id:`golden:${source_id}:${page}:${index}`,item_number:id==='362729'?'all':String(notice.items[0].numeroItem),source_id,location:content.location,quote,label:r.anchor.replace(/\s+/g,' ').slice(0,160),kind:typeof r.value==='number'?'numeric':/dimensions|iso_|size|shutter|temperature|frequencies|resolution|recording|tilt|range/.test(r.key)?'compound':'categorical',upper:null,conditions:['sem vento','sem carga','com carga'].filter(c=>quote.toLowerCase().includes(c)).join(';'),...(r.unit==='un'?{quantity_header_quote:literalEvidenceQuote('DESCRIÇÃO DO ITEM QUANTIDADE',content.text)}:{})};
 }));
 return {notice,facts,expected_document_complete:id==='362729',expected_reference_sources:id==='362554'?['226']:[],note:id==='362729'?'A unidade 21 MIN da tabela é incoerente com velocidade; preservar a dúvida, sem corrigir por suposição. A ficha anexa também exige GLONASS no TR e lista outra composição GNSS.':'O TR é citado, mas não está entre os documentos disponíveis; atendimento integral fica bloqueado.'};
}
module.exports={build};
