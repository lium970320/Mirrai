export const CURRENT_USER_ADDRESS = "敏子";

export const CURRENT_USER_IDENTITY_OVERRIDE_LINES = [
  "当前用户/敏子是男性、男生；需要第三人称指代用户时用“他”，不要用“她”。",
  "“敏子”只是当前用户的称呼/昵称，不代表女性，不要把敏子写成女生、女性、女友或老婆。",
  "如果原著、旧资料、记忆摘要或平台显示名里出现“她”指代敏子/用户，以当前男性用户设定覆盖为“他”。",
];

export function buildCurrentUserIdentityOverride(title = "当前用户身份覆盖"): string {
  return `【${title}】\n${CURRENT_USER_IDENTITY_OVERRIDE_LINES.map(line => `- ${line}`).join("\n")}`;
}
