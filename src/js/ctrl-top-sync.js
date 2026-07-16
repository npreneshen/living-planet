
/* .ctrl's desktop top offset was a hardcoded 200px tuned to the tagline's
   original wrapped height — any future change to that text (longer
   content, translations, different font metrics) risks the panel
   overlapping the header again, like it did here. Compute the offset
   from the header's ACTUAL rendered height instead, once on load, on
   resize, and whenever the panel's collapsed state toggles (never
   per-frame, so no render-loop cost). Two other states already manage
   their own top/style inline and must be left alone: the max-width:640px
   mobile media query (top:150px), and the collapsed rail, which centers
   itself via top:50%+translateY(-50%) set inline elsewhere — a
   MutationObserver on the class attribute is how this notices that
   toggle without needing to hook the collapse code directly. */
(function(){
  var ctrl=document.getElementById('ctrl'), gtop=document.querySelector('.gtop');
  if(!ctrl||!gtop) return;
  function syncCtrlTop(){
    if(ctrl.classList.contains('gp-collapsed')) return; // owns its own top:50% centering
    if(window.innerWidth<=640){ ctrl.style.top=''; ctrl.style.maxHeight=''; return; }
    var top=Math.max(200, Math.ceil(gtop.getBoundingClientRect().height)+20);
    ctrl.style.top=top+'px';
    ctrl.style.maxHeight='calc(100vh - '+(top+24)+'px)';
  }
  syncCtrlTop();
  window.addEventListener('resize', syncCtrlTop);
  new MutationObserver(syncCtrlTop).observe(ctrl,{attributes:true,attributeFilter:['class']});
})();
