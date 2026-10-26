'use strict';
// Shared vocabulary. Aliases describe the SAME property, never an assessment.
const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const groups = {
  flight_time: ['flight_duration','flight_time_minutes','battery_flight_time','battery_endurance','max_flight_time','maximum_flight_time','endurance'],
  motor_type: ['motorization','motor_technology'],
  return_to_home: ['return_home','rth','automatic_return_home'],
  professional_use: ['professional','professional_grade','professional_application'],
  long_range: ['long_distance','long_range_transmission'],
  gimbal_axes: ['gimbal_axis_count','gimbal_stabilization_axes','stabilization_axes'],
  gimbal_stabilization: ['stability_type','camera_stabilization','stabilization_type'],
  takeoff_altitude: ['max_takeoff_altitude','maximum_takeoff_altitude'],
  flight_ceiling: ['ceiling','service_ceiling','maximum_service_ceiling'],
  flight_speed: ['max_horizontal_speed','maximum_horizontal_speed','horizontal_speed','max_flight_speed'],
  wind_resistance: ['max_wind_resistance','wind_speed_resistance','maximum_wind_resistance'],
  anatel_certification: ['anatel_homologation','anatel_approval'],
  photo_formats: ['image_formats','photography_formats','photo_format'],
  camera_sensor: ['sensor_size','camera_sensor_size','image_sensor_size','wide_sensor_size','sensor_size_wide','main_camera_sensor','sensor_size_tele','sensor_size_thermal'],
  camera_resolution: ['effective_resolution','effective_pixels','photo_resolution_mp','wide_camera_resolution','main_camera_resolution','resolution_mp','effective_resolution_tele','effective_resolution_wide','effective_resolution_thermal'],
  video_formats: ['video_format'],
  video_resolution: ['video_resolution_k','camera_video_resolution'],
  thermal_resolution:['thermal_camera_resolution','infrared_resolution'],
  rtk_support: ['rtk','rtk_positioning','rtk_capable'],
  obstacle_sensing: ['obstacle_detection','obstacle_detection_sensors','obstacle_avoidance','obstacle_sensors'],
};
const aliases = Object.fromEntries(Object.entries(groups).flatMap(([key, values])=>values.map(v=>[v,key])));
function metricKey(value) { const key=clean(value).replace(/[\s-]+/g,'_');return aliases[key] || key; }
function componentOf(fact) {
  // An explicitly empty component means the whole equipment. Never infer a
  // battery/camera from an unrelated word in a long quoted item description.
  if(Object.hasOwn(fact,'component'))return ['aircraft','equipment','produto','aeronave'].includes(clean(fact.component)) ? '' : clean(fact.component);
  if (fact.component && !['aircraft','equipment','produto','aeronave'].includes(clean(fact.component))) return clean(fact.component);
  const key=clean(fact.key), label=clean(`${fact.section || ''} ${fact.label || ''}`);
  if (/thermal|termic/.test(key+' '+label))return 'thermal_camera';
  if (/(?:^|[_\s])tele(?:objetiva|photo)?(?:[_\s]|$)|zoom_camera/.test(key+' '+label))return 'tele_camera';
  if (/wide|grande.angular|camera principal/.test(key+' '+label))return 'wide_camera';
  if (/controller|controle remoto|controlador/.test(key+' '+label))return 'controller';
  if (/battery|bateria/.test(key+' '+label) && !/flight_time|autonomia/.test(key+' '+label))return 'battery';
  if (/^camera_(sensor|resolution)$/.test(metricKey(key)))return 'wide_camera';
  return '';
}
function conditionsKey(value) {
  return clean(value).replace(/\b(no wind|windless)\b/g,'sem vento').replace(/\b(ideal conditions|condicoes ideais de operacao)\b/g,'condicoes ideais')
    .replace(/\b(?:em|sob|with|in)\s+/g,'').replace(/\bcondicoes ideais(?: e)?\s*/g,'').split(/\s*(?:;|\|)\s*/).filter(Boolean).sort().join(';');
}
function conditionsCompatible(a,b){const required=conditionsKey(a.conditions),offered=conditionsKey(b.conditions);return !required || required===offered;}
function sameMetric(a,b) {
  if(metricKey(a.key)!==metricKey(b.key))return false;
  const ac=componentOf(a),bc=componentOf(b);
  return (!ac && !bc) || ac===bc;
}
function categoricalValue(fact) {
  const value=clean(fact.value),key=metricKey(fact.key);
  if(key==='professional_use'&&/^(?:uso )?profissional(?: — .*)?$|^professional(?: use)?$/.test(value))return 'professional_use';
  if(key==='long_range'&&/^(?:longo alcance|long[ -]range)(?: — .*)?$/.test(value))return 'long_range';
  if(key==='motor_type' && /^(brushless|motores? eletricos? sem escova|motores? sem escova|sem escova)$/.test(value))return 'brushless';
  if(key==='gimbal_stabilization' && /^(mecanica triaxial|mecanica em 3 eixos|3.axis mechanical|3-axis|3 eixos)$/.test(value))return 'mechanical_3_axis';
  if(key==='gimbal_stabilization' && /mecanic/.test(value) && /triaxial|3[ -]axis|3 eixos/.test(value))return 'mechanical_3_axis';
  if(!/\b(?:nao|sem|nenhum[ao]?|ausente|none|no|opcional|optional|not supported|without)\b/.test(value)){
    if(key==='wifi'&&/\bwi[ -]?fi\b|\b802\.11/.test(value))return 'wifi_supported';
    if(key==='bluetooth'&&/\bbluetooth\b/.test(value))return 'bluetooth_supported';
    if(key==='return_to_home'&&/\brth\b|return[ -]to[ -]home|auto[ -]?return|retorno.*(?:automatic|origem|decolagem|casa)/.test(value))return 'rth_supported';
    if(key==='controller_screen'&&/tela integrada|integrated screen|built.in/.test(value))return 'integrated_screen';
    if(key==='controller_screen'&&componentOf(fact)==='controller'&&/^(tela|controle remoto)$/.test(clean(fact.label))&&!/smartphone|celular|extern/.test(value)&&(/\d/.test(value)||/^(tela|sim|integrada)$/.test(value)))return 'integrated_screen';
    if(key==='memory_card_support'&&(/\bmicrosd\b/.test(value)||/^cartoes? microsd suportados/.test(clean(fact.label))))return 'microsd_supported';
  }
  return value;
}
module.exports={metricKey,componentOf,conditionsKey,conditionsCompatible,sameMetric,categoricalValue};
