/* Source and licensing information for the line(s) below can be found at //gs1go2.azureedge.net/core/misc/dialog/dialog.position.js. */
(function($,Drupal,drupalSettings,debounce,displace){drupalSettings.dialog=$.extend({autoResize:true,maxHeight:'95%'},drupalSettings.dialog,);function resetPosition(options){const offsets=displace.offsets;const left=offsets.left-offsets.right;const top=offsets.top-offsets.bottom;const leftString=`${
      (left > 0 ? '+' : '-') + Math.abs(Math.round(left / 2))
    }px`;const topString=`${
      (top > 0 ? '+' : '-') + Math.abs(Math.round(top / 2))
    }px`;options.position={my:`center${left !== 0 ? leftString : ''} center${
        top !== 0 ? topString : ''
      }`,of:window,};return options;}
function resetSize(event){const positionOptions=['width','height','minWidth','minHeight','maxHeight','maxWidth','position',];let adjustedOptions={};let windowHeight=$(window).height();let option;let optionValue;let adjustedValue;for(let n=0;n<positionOptions.length;n++){option=positionOptions[n];optionValue=event.data.settings[option];if(optionValue){if(typeof optionValue==='string'&&optionValue.endsWith('%')&&/height/i.test(option)){windowHeight-=displace.offsets.top+displace.offsets.bottom;adjustedValue=parseInt(0.01*parseInt(optionValue,10)*windowHeight,10,);if(option==='height'&&Math.round(event.data.$element.parent().outerHeight())<adjustedValue){adjustedValue='auto';}
adjustedOptions[option]=adjustedValue;}}}
if(!event.data.settings.modal){adjustedOptions=resetPosition(adjustedOptions);}
event.data.$element.dialog('option',adjustedOptions);event.data.$element?.get(0)?.dispatchEvent(new CustomEvent('dialogContentResize',{bubbles:true}),);}
window.addEventListener('dialog:aftercreate',(e)=>{const autoResize=debounce(resetSize,20);const $element=$(e.target);const{settings}=e;const eventData={settings,$element};if(settings.autoResize===true||settings.autoResize==='true'){const uiDialog=$element.dialog('option',{resizable:false,draggable:false}).dialog('widget');uiDialog[0].style.position='fixed';$(window).on('resize.dialogResize scroll.dialogResize',eventData,autoResize).trigger('resize.dialogResize');$(document).on('drupalViewportOffsetChange.dialogResize',eventData,autoResize,);}});window.addEventListener('dialog:beforeclose',()=>{$(window).off('.dialogResize');$(document).off('.dialogResize');});})(jQuery,Drupal,drupalSettings,Drupal.debounce,Drupal.displace);
/* Source and licensing information for the above line(s) can be found at //gs1go2.azureedge.net/core/misc/dialog/dialog.position.js. */