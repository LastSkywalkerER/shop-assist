/* Source and licensing information for the line(s) below can be found at //gs1go2.azureedge.net/core/misc/debounce.js. */
Drupal.debounce=function(func,wait,immediate){let timeout;let result;return function(...args){const context=this;const later=function(){timeout=null;if(!immediate){result=func.apply(context,args);}};const callNow=immediate&&!timeout;clearTimeout(timeout);timeout=setTimeout(later,wait);if(callNow){result=func.apply(context,args);}
return result;};};
/* Source and licensing information for the above line(s) can be found at //gs1go2.azureedge.net/core/misc/debounce.js. */