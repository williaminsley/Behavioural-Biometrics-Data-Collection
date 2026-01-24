// public/words.js
// Client-only word pool. You DO NOT store raw text to Firestore.
// You store wordId + length (+ difficulty if you want) and timing only.

export const WORDS = [
  // ---- XS (1–3) ----
  "a","i","an","am","as","at","be","by","do","go","he","if","in","is","it","me","my","no","of","oh","on","or","ox","so","to","up","us","we","ya","yes","you",
  "air","and","ant","any","are","arm","art","ask","bad","bag","ban","bar","bat","bay","bed","bee","beg","bet","big","bin","bit","box","boy","bud","bus","buy",
  "cab","can","cap","car","cat","cop","cow","cry","cup","cut","day","den","did","die","dig","dip","dog","dry","due","ear","eat","ego","elf","end","era","eye",
  "far","fat","few","fig","fit","fix","fly","for","fox","fun","gap","gas","gem","get","gin","god","gum","guy","had","ham","has","hat","her","hid","him","hip",
  "his","hit","hot","how","ice","ink","job","joy","key","kid","lab","lad","lag","law","lay","led","let","lid","lie","lip","log","lot","low","mad","map","mix",
  "mob","mom","mud","nap","net","new","nor","now","odd","off","old","one","out","own","pan","pay","pen","pet","pie","pin","pit","pop","pot","pro","put","ran",
  "raw","ray","red","rid","rig","rip","rod","row","run","sad","say","sea","see","set","she","shy","sir","sit","six","ski","sky","son","sun","tag","tan","tap",
  "tea","ten","the","tie","tin","tip","top","toy","try","two","use","van","war","was","way","who","why","win","won","yes","yet","zip","zoo",

  // ---- S (4–5) ----
  "able","about","above","actor","adapt","admit","after","again","agent","agree","ahead","alarm","album","alert","alive","allow","alone","along","alter","among",
  "angle","angry","apart","apple","apply","arena","argue","arise","array","aside","asset","audio","audit","avoid","awake","award","aware","basic","batch","beach",
  "began","begin","begun","being","below","bench","birth","black","blade","blame","blank","blend","block","board","boost","bound","brain","brand","brave","bread",
  "break","brick","brief","bring","broad","broke","brown","build","built","buyer","cable","carry","catch","cause","chain","chair","chart","chase","cheap","check",
  "cheer","chess","chief","child","chill","choir","civil","claim","class","clean","clear","clerk","click","cliff","climb","clock","close","cloud","coach","coast",
  "could","count","court","cover","crack","craft","crash","cream","crime","cross","crowd","crown","curve","daily","dance","death","debug","delay","depth","digit",
  "dirty","doubt","dozen","draft","drama","dream","dress","drift","drink","drive","drove","eager","early","earth","eight","elite","empty","enemy","enjoy","enter",
  "entry","equal","error","event","every","exact","exist","extra","faith","false","fancy","fault","fibre","field","fight","final","first","fixed","flash","fleet",
  "floor","focus","force","forth","frame","fresh","front","fruit","fully","funny","giant","given","glass","globe","going","grace","grade","grant","grass","great",
  "green","gross","group","grown","guard","guess","guest","guide","habit","happy","harsh","heart","heavy","hence","house","human","image","index","inner","input",
  "issue","joint","judge","known","label","large","later","laugh","layer","learn","least","leave","legal","level","light","limit","local","logic","loose","lucky",
  "lunch","major","maker","march","match","maybe","media","metal","might","minor","model","money","month","moral","motor","mount","mouse","mouth","movie","music",
  "never","night","noise","north","novel","nurse","occur","ocean","offer","often","order","other","owner","panel","paper","party","peace","phase","phone","photo",
  "piece","pilot","pitch","place","plain","plane","plant","plate","point","power","press","price","pride","prime","print","prior","prize","proof","proud","prove",
  "quick","quiet","quite","radio","raise","range","rapid","ratio","reach","react","ready","refer","reply","right","river","robot","rough","round","route","royal",
  "rules","rural","scale","scene","scope","score","sense","serve","seven","shall","shape","share","sharp","sheet","shift","shock","shoot","short","shown","skill",
  "sleep","small","smart","smile","smoke","solid","solve","sound","south","space","spare","speak","speed","spend","spent","split","sport","stack","stage","stand",
  "start","state","steam","steel","stick","still","stock","stone","store","storm","story","strip","study","style","sugar","suite","super","sweet","table","taken",
  "taste","teach","terms","thank","their","theme","there","thick","thing","think","three","throw","tight","timer","title","today","topic","total","touch","tough",
  "tower","trace","trade","train","treat","trend","trial","trust","truth","twice","under","union","unity","until","upper","usage","usual","value","video","voice",
  "waste","watch","water","wheel","where","which","while","white","whole","whose","woman","women","world","worry","worth","would","write","wrong",

  // ---- M (6–8) ----
  "account","actions","advance","airport","alcohol","analogue","anywhere","appeared","approve","arrival","article","attempt","average","balance","banking","battery",
  "behaviour","between","billion","binding","briefly","browser","builder","capital","capture","central","certain","changed","channel","context","control","correct",
  "council","country","creator","current","customer","cylinder","decline","default","deliver","density","desktop","details","develop","digital","discuss","display",
  "distant","dynamic","economy","edition","element","emphasis","encoded","enhance","episode","evaluate","exactly","example","execute","explain","extract","feature",
  "finance","focused","foreign","forward","freedom","general","generate","gesture","goodness","gravity","greater","happened","headline","heritage","historic",
  "identity","improve","include","increase","indicate","infinite","informed","initial","inquiry","install","instant","integer","intense","interval","invariant",
  "keyboard","language","learning","library","limited","location","magnetic","majority","material","measured","measures","mention","message","metadata","midnight",
  "minimal","moderate","mobility","momentum","multiple","narrative","navigate","negative","notable","notebook","notified","objective","observed","official","operate",
  "operator","optional","overview","password","patterns","personal","pipeline","platform","possible","practice","predict","premium","privacy","probable","profile",
  "progress","project","provide","quality","question","randomly","reaction","realism","recover","reduced","related","release","remains","replace","request","require",
  "resource","responds","results","revenue","rolling","routine","running","science","section","separate","session","setting","several","shortest","simulate","society",
  "software","solution","somehow","specific","stability","standard","station","storage","strategy","stressed","subject","support","surface","survival","teacher",
  "testing","theory","through","together","tracking","training","transfer","uniform","utility","variance","version","vibration","volatile","weighted","whenever",
  "wireless","workflow",

  // ---- L (9–12) ----
  "additional","adjustment","afterwards","algorithmic","alternative","ambiguous","assessment","behaviours","calibration","cancellation","categorical","chronology",
  "collection","comfortable","commercial","comparison","completion","confidence","consistent","constraint","constructor","continuous","contribution","correlation",
  "credential","customisable","declaration","definition","dependence","deployment","derivative","difficulty","dissertation","distinctive","distributed","econometrics",
  "efficiency","electricity","engagement","engineering","enterprise","environment","equilibrium","evaluation","eventstudy","experiment","exponential","familiarity",
  "foundation","frequently","generation","geographic","governance","hypothesis","identities","independent","inequality","information","infrastructure","initialize",
  "innovation","instrument","intelligent","interested","interfaces","interpret","investment","leadership","likelihood","limitations","manipulate","mathematics",
  "mechanistic","memorising","methodology","microtiming","modernising","modularity","motivation","navigation","normalised","observation","operational","organisation",
  "participant","performance","persistent","permission","personality","photographic","population","prediction","preprocess","probability","progression","prohibiting",
  "protection","publication","questionnaire","recognition","regression","regulatory","reliability","repetition","representation","researching","resilience",
  "resolution","restriction","satisfactory","segmentation","sensitivity","significant","simulation","specialised","specification","sufficient","suppression",
  "sustainable","synchronise","technology","telemetry","theoretical","thresholds","timestamped","transforms","transition","understand","variability","verification",
  "visualising",

  // ---- XL (13+) ----
  "characterisation","contextualisation","counterproductive","depersonalisation","disproportionately","electrochemical","environmentalism",
  "internationalisation","interoperability","intercontinental","interdisciplinary","interinstitutional",
  "misinterpretation","multidimensionality","nonrepresentational","operationalisation","overgeneralisation",
  "parameterisation","professionalisation","reconceptualisation","representationalism","responsiveness",
  "standardisation","thermodynamically","transcontinentalism","uncharacteristically","unpredictability",
  "inconsequentially","institutionalisation","microarchitectures","heteroscedasticity","compartmentalisation"
];

// ---- Difficulty metadata (computed) ----
// 1 = very easy, 5 = very hard
function hasRareLetters(w) {
  return /[jqxz]/.test(w);
}
function hasDoubleLetters(w) {
  return /(bb|cc|dd|ff|gg|hh|jj|kk|ll|mm|nn|pp|qq|rr|ss|tt|vv|ww|xx|yy|zz)/.test(w);
}
function hasConsonantCluster(w) {
  // simple heuristic: 3 consonants in a row
  return /[bcdfghjklmnpqrstvwxyz]{3}/.test(w);
}
function hasHardSuffix(w) {
  return /(tion|sion|ment|ness|ship|ously|ability|isation|ization|ology|graphy)$/.test(w);
}

export function difficultyOf(word) {
  const n = word.length;

  let d = 1;
  if (n >= 4) d = 2;
  if (n >= 7) d = 3;
  if (n >= 10) d = 4;
  if (n >= 14) d = 5;

  // bump difficulty for “hardness” features
  let bump = 0;
  if (hasRareLetters(word)) bump += 1;
  if (hasConsonantCluster(word)) bump += 1;
  if (hasDoubleLetters(word)) bump += 1;
  if (hasHardSuffix(word)) bump += 1;

  // cap to 5
  return Math.min(5, d + Math.floor(bump / 2));
}

// Precomputed metadata for fast lookup
export const WORD_META = WORDS.map((text, wordId) => ({
  wordId,
  text,
  length: text.length,
  difficulty: difficultyOf(text),
}));