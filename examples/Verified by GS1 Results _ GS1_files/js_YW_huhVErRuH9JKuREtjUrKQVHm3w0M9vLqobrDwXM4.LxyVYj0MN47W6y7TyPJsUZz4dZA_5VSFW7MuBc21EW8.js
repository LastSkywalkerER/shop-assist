/* Source and licensing information for the line(s) below can be found at //gs1go2.azureedge.net/core/modules/ckeditor5/js/ckeditor5.dialog.fix.js. */
(($)=>{$.widget('ui.dialog',$.ui.dialog,{_allowInteraction(event){if(event.target.classList===undefined){return this._super(event);}
return event.target.classList.contains('ck')||this._super(event);},});})(jQuery);
/* Source and licensing information for the above line(s) can be found at //gs1go2.azureedge.net/core/modules/ckeditor5/js/ckeditor5.dialog.fix.js. */