export const widgetStyles = `
  :host { all: initial; position: fixed; z-index: 2147483000; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #12211b; }
  :host([position="BOTTOM_RIGHT"]) { right: 20px; bottom: 20px; }
  :host([position="BOTTOM_LEFT"]) { left: 20px; bottom: 20px; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, textarea, select { font: inherit; }
  .launcher { position: relative; width: 58px; height: 58px; border: 0; border-radius: 20px; color: white; cursor: pointer; display: grid; place-items: center; box-shadow: 0 18px 45px rgba(18,33,27,.24); transition: transform .2s ease; margin-left: auto; font-size: 24px; }
  .unread-badge { position: absolute; right: -5px; top: -5px; min-width: 21px; height: 21px; padding: 0 6px; display: grid; place-items: center; border: 2px solid white; border-radius: 999px; background: #dc4b4b; color: white; font-size: 10px; font-weight: 750; }
  .launcher:hover { transform: translateY(-2px); }
  .panel { width: min(372px, calc(100vw - 32px)); height: min(590px, calc(100vh - 104px)); background: #fff; border: 1px solid #dce4de; border-radius: 24px; box-shadow: 0 24px 80px rgba(18,33,27,.18); overflow: hidden; display: flex; flex-direction: column; margin-bottom: 12px; }
  .header { color: white; padding: 20px; }
  .header-row, .composer-row { display: flex; align-items: center; gap: 12px; }
  .header-row { justify-content: space-between; }
  .eyebrow { margin: 0 0 5px; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; opacity: .72; }
  .title { margin: 0; font-size: 18px; line-height: 1.25; font-weight: 750; }
  .close { border: 0; background: rgba(255,255,255,.14); color: white; width: 34px; height: 34px; border-radius: 11px; cursor: pointer; font-size: 20px; }
  .status-strip { min-height: 35px; padding: 9px 14px; border-bottom: 1px solid #e7ece8; background: #f7f9f7; display: flex; justify-content: space-between; gap: 14px; align-items: center; font-size: 11px; color: #526159; }
  .status { display: inline-flex; align-items: center; gap: 6px; text-transform: capitalize; }
  .secure { color: #78847d; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #94a39a; }
  .dot.connected { background: #19a261; box-shadow: 0 0 0 3px rgba(25,162,97,.12); }
  .dot.connecting, .dot.reconnecting { background: #e7a321; }
  .dot.error { background: #dc4b4b; }
  .body { flex: 1; padding: 20px; background: linear-gradient(180deg,#fff 0%,#fafbf9 100%); overflow-y: auto; overscroll-behavior: contain; }
  .welcome { border: 1px solid #e1e8e3; border-radius: 16px; padding: 15px; background: white; }
  .welcome h3 { font-size: 15px; margin: 0; }
  .welcome p { margin: 7px 0 0; color: #68756e; font-size: 12px; line-height: 1.5; }
  .department-picker { display: block; margin-top: 13px; color: #526159; font-size: 11px; font-weight: 650; }
  .department-picker span { display: block; margin-bottom: 6px; }
  .department-picker select { width: 100%; height: 38px; border: 1px solid #dce4de; border-radius: 11px; padding: 0 10px; color: #12211b; background: white; outline: none; }
  .topic-picker { margin: 14px 0 0; padding: 12px; border: 1px solid #dce4de; border-radius: 14px; background: #f7f9f8; }
  .topic-picker p { margin: 0 0 9px; color: #26342d; font-size: 12px; font-weight: 650; }
  .topic-options { display: flex; flex-wrap: wrap; gap: 6px; }
  .topic { padding: 7px 11px; border: 1px solid #c9d6ce; border-radius: 999px; background: white; color: #155f43; cursor: pointer; font-size: 12px; font-weight: 600; }
  .topic:hover, .topic:focus-visible { border-color: #155f43; outline: none; }
  .topic.selected { border-color: #155f43; background: #155f43; color: white; }
  .messages { list-style: none; padding: 0; margin: 18px 0 0; display: flex; flex-direction: column; gap: 10px; }
  .message { display: flex; }
  .message.outgoing { justify-content: flex-end; }
  .bubble { max-width: 82%; border-radius: 16px 16px 16px 5px; padding: 10px 12px 7px; background: #edf1ee; color: #26342d; }
  .outgoing .bubble { border-radius: 16px 16px 5px 16px; background: #155f43; color: white; }
  .bubble p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.45; }
  .message-meta { margin-top: 5px; font-size: 9px; opacity: .67; text-align: right; text-transform: capitalize; }
  .retry { margin: 6px 0 0; padding: 3px 7px; border: 1px solid rgba(255,255,255,.5); border-radius: 8px; background: transparent; color: inherit; cursor: pointer; font-size: 10px; }
  .load-earlier { display: block; margin: 14px auto -5px; padding: 6px 10px; border: 0; background: transparent; color: #155f43; cursor: pointer; font-size: 11px; font-weight: 650; }
  .typing { margin: 11px 0 0; display: flex; align-items: center; gap: 4px; color: #68756e; font-size: 10px; }
  .typing span { width: 5px; height: 5px; border-radius: 50%; background: #7f9187; animation: bounce 1s infinite alternate; }
  .typing span:nth-child(2) { animation-delay: .2s; } .typing span:nth-child(3) { animation-delay: .4s; }
  .typing em { margin-left: 4px; font-style: normal; }
  @keyframes bounce { to { transform: translateY(-3px); opacity: .45; } }
  .error-box { border-radius: 16px; background: #fff1f1; color: #9f3030; padding: 14px; font-size: 12px; line-height: 1.45; }
  .composer { padding: 12px 14px; border-top: 1px solid #e7ece8; background: white; }
  .composer-row { align-items: flex-end; }
  textarea { flex: 1; min-height: 48px; max-height: 110px; resize: none; border: 1px solid #dce4de; border-radius: 14px; padding: 11px 12px; color: #12211b; background: #fff; outline: none; line-height: 1.35; }
  textarea:focus { border-color: #77ab93; box-shadow: 0 0 0 3px rgba(21,95,67,.08); }
  textarea:disabled { color: #86918b; background: #f7f8f7; }
  .send { width: 46px; height: 46px; flex: 0 0 46px; display: grid; place-items: center; border: 0; border-radius: 14px; color: white; cursor: pointer; }
  .attach { width: 38px; height: 38px; flex: 0 0 38px; border: 1px solid #dce4de; border-radius: 12px; background: #fff; color: #526159; cursor: pointer; font-size: 16px; }
  .attach:disabled { opacity: .45; cursor: not-allowed; }
  .attachment { display: block; max-width: 100%; margin-top: 8px; overflow: hidden; border: 0; border-radius: 10px; background: rgba(255,255,255,.16); color: inherit; cursor: pointer; padding: 7px 8px; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; text-align: left; }
  .message:not(.outgoing) .attachment { background: #fff; border: 1px solid #dce4de; color: #155f43; }
  .send:disabled { opacity: .45; cursor: not-allowed; }
  .composer-note { margin: 7px 2px 0; color: #98a19c; font-size: 10px; }
  .error-text { color: #b53a3a; }
  .loading { display: grid; place-items: center; height: 100%; color: #68756e; font-size: 13px; }
  @media (max-width: 520px) { :host { right: 12px !important; left: 12px !important; bottom: 12px; } .panel { width: calc(100vw - 24px); height: calc(100vh - 94px); } }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
