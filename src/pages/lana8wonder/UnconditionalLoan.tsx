import { HandCoins } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useLang } from "@/i18n/I18nContext";

// A block of the article. `h` = section heading, `p` = paragraph, `ul` = bullets.
type Block = { h: string } | { p: string } | { ul: string[] };

interface Article {
  title: string;
  subtitle: string;
  blocks: Block[];
}

// ── Slovenian (source) ──
const SL: Article = {
  title: "Brezpogojni krediti v Lana ekosistemu",
  subtitle: "Skupnost, ki človeku zaupa",
  blocks: [
    { p: "Brezpogojni krediti so skupnostna oblika financiranja znotraj Lana ekosistema. Namenjeni so ljudem, ki so aktivno vključeni v Lano, čutijo obilje ter s svojim življenjem in delovanjem prispevajo k širjenju skupnega dobrega." },
    { p: "Ne temeljijo na klasični bančni presoji, premoženju, zaposlitvi, kreditni sposobnosti ali dokazovanju, da si človek podporo zasluži." },
    { p: "Temeljijo na:" },
    { ul: [
      "zaupanju,",
      "transparentnosti,",
      "aktivni vključenosti v skupnost,",
      "samoodgovornosti,",
      "občutku za skupno dobro,",
      "ter pripravljenosti, da prejeta sredstva ponovno vrnemo v skupni tok, kadar je to mogoče.",
    ] },

    { h: "Brezpogojno ne pomeni brez samoodgovornosti." },
    { p: "Pomeni, da človeka ne pogojujemo z njegovo preteklostjo, trenutnim finančnim položajem ali premoženjem. Gledamo njegovo resnično prisotnost, njegov odnos do skupnosti in smer, v katero želi s podporo skupnosti stopiti." },

    { h: "Kdo lahko zaprosi za brezpogojni kredit?" },
    { p: "Za brezpogojni kredit ne more zaprositi nekdo, ki se je Lani pravkar pridružil." },
    { p: "Posameznik mora biti pred oddajo kreditne vloge v Lana ekosistemu prisoten najmanj štiri Splite. Tako ima dovolj časa, da spozna skupnost, njeno delovanje, vrednote in odgovornost, ki jo prinaša sodelovanje v skupnem finančnem toku." },
    { p: "Poleg tega mora biti aktiven član skupnosti." },
    { p: "Aktivnost ni omejena zgolj na eno vrsto sodelovanja. Človek lahko prispeva:" },
    { ul: [
      "s svojim znanjem in delom,",
      "z uporabo in širjenjem Lane,",
      "s povezovanjem ljudi,",
      "z ustvarjanjem projektov,",
      "s podporo drugim članom,",
      "s sodelovanjem na dogodkih,",
      "z razvojem izdelkov ali storitev,",
      "z navdihovanjem drugih,",
      "ali na drug način, ki krepi skupnost in širi obilje.",
    ] },
    { p: "Vsak, ki želi vstopiti v sistem brezpogojnih kreditov, se mora najprej predstaviti skupnosti in opisati, kako je vanjo vključen." },

    { h: "Dve ločeni prijavi" },
    { p: "Sistem brezpogojnih kreditov vključuje dva koraka." },
    { h: "1. Prijava v skupnost brezpogojnih kreditov" },
    { p: "Posameznik najprej odda osebno predstavitev, v kateri opiše:" },
    { ul: [
      "kdo je,",
      "kako dolgo je prisoten v Lani,",
      "kako sodeluje v Lana ekosistemu,",
      "kaj je do zdaj prispeval skupnosti,",
      "kako podpira smer obilja,",
      "ter zakaj želi postati del skupnosti brezpogojnih kreditov.",
    ] },
    { p: "S tem ne zaprosi še za konkretna sredstva. Najprej se predstavi kot človek, ki želi sodelovati v skupnem sistemu zaupanja, podpore in samoodgovornosti." },
    { h: "2. Vloga za posamezni kredit" },
    { p: "Ko je posameznik del kreditne skupnosti, lahko odda ločeno vlogo za konkretni brezpogojni kredit." },
    { p: "V njej opiše:" },
    { ul: [
      "koliko sredstev potrebuje,",
      "za kaj jih potrebuje,",
      "kako jih namerava uporabiti,",
      "ali gre za osebni ali skupnostno-poslovni namen,",
      "ali želi sredstva prejeti naenkrat ali postopoma,",
      "ter kako si predstavlja njihovo vračanje.",
    ] },
    { p: "Vsak kredit ima svoj namen, svojo zgodbo, svoj proces zorenja in svoj namenski račun." },

    { h: "Osebni brezpogojni kredit" },
    { p: "Osebni kredit je namenjen človeku, ki želi premostiti določeno življenjsko ali finančno situacijo." },
    { p: "Uporabi ga lahko na primer za:" },
    { ul: [
      "ureditev življenjskih razmer,",
      "selitev,",
      "izobraževanje,",
      "zdravljenje ali regeneracijo,",
      "pomemben osebni nakup,",
      "poravnavo obveznosti,",
      "ponovno vzpostavitev stabilnosti,",
      "ali katerokoli drugo iskreno osebno potrebo.",
    ] },
    { p: "Pri osebnem kreditu predhodni crowdfunding projekt ni potreben." },
    { p: "Človeku ni treba dokazovati, da bo s kreditom ustvaril dobiček. Včasih človek potrebuje podporo preprosto zato, da lahko ponovno vzpostavi ravnovesje, zadihano stopi naprej in se ponovno vključi v polnost življenja." },

    { h: "Kredit za skupnostni projekt ali podjetje" },
    { p: "Brezpogojni kredit se lahko uporabi tudi za razvoj podjetja, izdelka, storitve ali projekta." },
    { p: "Vendar pri tem ne govorimo o klasičnem poslovnem modelu, katerega glavni namen so dobiček, rast podjetja ali ustvarjanje novih delovnih mest." },
    { p: "Podjetja in projekti, ki nastajajo znotraj Lane, so namenjeni širitvi skupnosti in skupnemu dobremu." },
    { p: "Njihov namen je lahko:" },
    { ul: [
      "ustvarjanje novih izdelkov in storitev za skupnost,",
      "širjenje Lana ekonomije,",
      "izboljševanje kakovosti življenja,",
      "povezovanje ljudi,",
      "skrb za naravo, živali in človeka,",
      "širjenje znanja,",
      "ustvarjanje novih oblik sodelovanja,",
      "ter navdihovanje drugih, da tudi sami začnejo ustvarjati iz obilja.",
    ] },
    { p: "Tak projekt lahko seveda vključuje tudi delo, sodelovanje in ustvarjanje prihodkov, vendar njegov temeljni smisel ni klasično zaposlovanje ljudi ali ustvarjanje dobička zase." },
    { p: "Njegov smisel je ustvariti nekaj, kar koristi širši skupnosti." },

    { h: "Crowdfunding kot prvi korak" },
    { p: "Če posameznik zaproša za kredit za projekt ali podjetje, mora biti na isto temo pred tem že izveden crowdfunding projekt." },
    { p: "Crowdfunding je prvi korak, skozi katerega se:" },
    { ul: [
      "ideja predstavi skupnosti,",
      "preveri odziv ljudi,",
      "začne graditi zaupanje,",
      "zbere začetna podpora,",
      "ter pokaže, da je posameznik pripravljen projekt dejansko začeti razvijati.",
    ] },
    { p: "Brezpogojni kredit nato ni začetek popolnoma nepreverjene ideje, temveč naslednji korak projekta, ki je svojo pot v skupnosti že začel." },

    { h: "Osem dni zorenja" },
    { p: "Vsaka kreditna vloga po oddaji vstopi v obdobje zorenja, ki traja osem dni." },
    { p: "V tem času imajo člani skupnosti možnost, da:" },
    { ul: [
      "preberejo predstavitev,",
      "začutijo namen kredita,",
      "pregledajo podane informacije,",
      "postavijo vprašanja,",
      "ter glasujejo o kreditnem predlogu.",
    ] },
    { p: "Namen zorenja ni klasično ocenjevanje človeka ali iskanje razlogov, zakaj mu ne bi zaupali." },
    { p: "Namen je, da skupnost dobi čas, da kredit zares vidi, začuti in preveri njegovo usklajenost z vrednotami Lane." },
    { p: "Prosilec lahko v tem obdobju svojo vlogo dopolni, odgovori na vprašanja in razjasni morebitne pomisleke." },

    { h: "Glasovanje prek Lana Alignmenta" },
    { p: "O kreditih glasujejo ljudje, ki imajo pravico sodelovati v glasovanjih Lana Alignmenta." },
    { p: "Za brezpogojne kredite se uporabljajo enaka pravila glasovalne upravičenosti kot pri drugih referendumih znotraj Lana Alignmenta. Tako ne ustvarjamo novega ločenega sistema odločanja, temveč brezpogojne kredite vključujemo v že obstoječo obliko skupnostnega usklajevanja." },
    { p: "Pri glasovanju obstajata samo dve možnosti:" },
    { ul: [
      "potrditev kredita,",
      "zavrnitev kredita.",
    ] },
    { p: "Ni nevtralnega ali vmesnega glasu." },
    { p: "Človek, ki kredit zavrne, lahko svojo odločitev med obdobjem zorenja kadarkoli spremeni." },
    { p: "To je pomembno predvsem takrat, ko prosilec:" },
    { ul: [
      "dopolni manjkajoče informacije,",
      "odgovori na vprašanje,",
      "pojasni namen kredita,",
      "odpravi nesporazum,",
      "ali na drug način razjasni razlog za zavrnitev.",
    ] },
    { p: "Glasovanje ni namenjeno dokončnemu obsojanju človeka. Je živ proces usklajevanja, v katerem se lahko odnos do predloga spremeni, ko pridejo na voljo nove informacije." },
    { p: "Po osmih dneh se referendum zaključi, rezultat pa se določi po pravilih Lana Alignmenta." },

    { h: "Izplačilo kredita" },
    { p: "Odobren kredit se lahko izplača na dva načina." },
    { h: "Enkratno izplačilo" },
    { p: "Celoten odobreni znesek se izplača naenkrat." },
    { p: "To je primerno, kadar človek sredstva potrebuje takoj, na primer za nakup, poravnavo obveznosti ali izvedbo določene faze projekta." },
    { h: "Postopno izplačevanje" },
    { p: "Sredstva se lahko izplačujejo postopoma:" },
    { ul: [
      "ob vsakem Splitu,",
      "mesečno,",
      "v drugih dogovorjenih obdobjih,",
      "ali ob doseganju posameznih faz projekta.",
    ] },
    { p: "Način izplačevanja je določen že v kreditni vlogi in je viden skupnosti v času zorenja." },

    { h: "Vračanje kredita" },
    { p: "Brezpogojni kredit nima klasičnega, togo določenega mesečnega obroka." },
    { p: "Posameznik ga lahko vrača:" },
    { ul: [
      "skozi sredstva, ki jih prejema v Lana8Wonder,",
      "iz prihodkov svojega projekta,",
      "z neposrednimi nakazili,",
      "z manjšimi ali večjimi prostovoljnimi plačili,",
      "ali na drug način, ki mu ga omogoča njegova trenutna situacija.",
    ] },
    { p: "Kredit lahko vrača v poljubnih zneskih. Kadarkoli ga lahko tudi v celoti predčasno poplača." },
    { p: "Če želi skupnosti vrniti več, kot je prejel, lahko kredit prostovoljno preplača. Ta presežek ni obrestna mera, temveč prostovoljni prispevek v skupni fond, iz katerega bodo podporo prejemali prihodnji člani." },

    { h: "Kaj se zgodi, če kredita ni mogoče vrniti?" },
    { p: "Brezpogojnost kredita se zares pokaže takrat, ko se v življenju zgodijo okoliščine, zaradi katerih človek sredstev objektivno ne more vrniti." },
    { p: "Če se zgodi takšna situacija, kredita ni treba vrniti." },
    { p: "Človek zaradi tega ne postane dolžnik skupnosti v klasičnem smislu, ni kaznovan in dolg ne postane breme, ki bi ga spremljalo skozi življenje." },
    { p: "To ne pomeni, da se kredit že od začetka jemlje z namenom, da ne bo vrnjen." },
    { p: "Vsakdo k njemu pristopi samoodgovorno in z iskrenim namenom, da ga bo vrnil, ko in če bo to mogoče." },
    { p: "Hkrati Lana8Wonder ustvarja sistem, skozi katerega lahko ljudje sčasoma prejemajo sredstva in zato svoje kredite praviloma tudi povrnejo. Vračanje je tako naravni del kroženja obilja, ne pa prisila, ki temelji na strahu." },
    { p: "Če pa življenje pokaže drugače, človek ostaja pomembnejši od dolga." },

    { h: "Namenski račun za vsak kredit" },
    { p: "Za vsak kredit se ustvari ločen namenski račun, na katerem so pregledno vidni:" },
    { ul: [
      "odobreni znesek,",
      "namen kredita,",
      "način izplačila,",
      "že izplačana sredstva,",
      "izvedena vračila,",
      "morebitna prostovoljna preplačila,",
      "preostali znesek,",
      "ter trenutni status kredita.",
    ] },
    { p: "Tako lahko posameznik in skupnost ves čas spremljata, kako se sredstva gibljejo." },

    { h: "Živ tok skupnostnega obilja" },
    { p: "Ko se kredit vrne, se sredstva ne končajo." },
    { p: "Vrnejo se v skupni fond ter postanejo podpora naslednjemu človeku ali projektu." },
    { p: "Nekdo danes prejme podporo skupnosti. Jutri lahko s svojim vračilom, delovanjem in prispevkom omogoči podporo nekomu drugemu." },
    { p: "Brezpogojni kredit zato ni samo finančno orodje." },
    { p: "Je kroženje:" },
    { ul: [
      "zaupanja,",
      "priložnosti,",
      "odgovornosti,",
      "podpore,",
      "in obilja.",
    ] },
    { p: "Ni vprašanje, ali je človek dovolj bogat, da si lahko izposodi denar." },
    { p: "Vprašanje je, ali smo kot skupnost dovolj bogati, da lahko zaupamo človeku." },
  ],
};

// ── English (translation) ──
const EN: Article = {
  title: "Unconditional Loans in the Lana Ecosystem",
  subtitle: "A community that trusts the person",
  blocks: [
    { p: "Unconditional loans are a community form of financing within the Lana ecosystem. They are meant for people who are actively involved in Lana, who feel abundance, and who through their life and work contribute to spreading the common good." },
    { p: "They are not based on classic banking assessment, assets, employment, creditworthiness, or on proving that a person deserves support." },
    { p: "They are based on:" },
    { ul: [
      "trust,",
      "transparency,",
      "active involvement in the community,",
      "self-responsibility,",
      "a sense of the common good,",
      "and a readiness to return the received funds back into the shared flow whenever that is possible.",
    ] },

    { h: "Unconditional does not mean without self-responsibility." },
    { p: "It means we do not make a person conditional on their past, their current financial situation, or their assets. We look at their true presence, their relationship with the community, and the direction in which they want to step with the community's support." },

    { h: "Who can apply for an unconditional loan?" },
    { p: "Someone who has only just joined Lana cannot apply for an unconditional loan." },
    { p: "Before submitting a loan application, an individual must have been present in the Lana ecosystem for at least four Splits. This gives them enough time to get to know the community, how it works, its values, and the responsibility that participating in the shared financial flow brings." },
    { p: "In addition, they must be an active member of the community." },
    { p: "Activity is not limited to only one kind of participation. A person can contribute:" },
    { ul: [
      "with their knowledge and work,",
      "by using and spreading Lana,",
      "by connecting people,",
      "by creating projects,",
      "by supporting other members,",
      "by taking part in events,",
      "by developing products or services,",
      "by inspiring others,",
      "or in any other way that strengthens the community and spreads abundance.",
    ] },
    { p: "Everyone who wishes to enter the unconditional-loan system must first introduce themselves to the community and describe how they are involved in it." },

    { h: "Two separate applications" },
    { p: "The unconditional-loan system involves two steps." },
    { h: "1. Joining the unconditional-loan community" },
    { p: "The individual first submits a personal introduction, in which they describe:" },
    { ul: [
      "who they are,",
      "how long they have been present in Lana,",
      "how they participate in the Lana ecosystem,",
      "what they have contributed to the community so far,",
      "how they support the direction of abundance,",
      "and why they wish to become part of the unconditional-loan community.",
    ] },
    { p: "With this, they are not yet requesting any specific funds. First they present themselves as a person who wants to take part in a shared system of trust, support, and self-responsibility." },
    { h: "2. Application for an individual loan" },
    { p: "Once an individual is part of the loan community, they can submit a separate application for a specific unconditional loan." },
    { p: "In it, they describe:" },
    { ul: [
      "how much they need,",
      "what they need it for,",
      "how they intend to use it,",
      "whether it is for a personal or a community-business purpose,",
      "whether they wish to receive the funds all at once or gradually,",
      "and how they envisage repaying it.",
    ] },
    { p: "Every loan has its own purpose, its own story, its own maturing process, and its own dedicated account." },

    { h: "Personal unconditional loan" },
    { p: "A personal loan is meant for a person who wants to get through a particular life or financial situation." },
    { p: "They can use it, for example, for:" },
    { ul: [
      "sorting out their living situation,",
      "moving,",
      "education,",
      "treatment or recovery,",
      "an important personal purchase,",
      "settling obligations,",
      "re-establishing stability,",
      "or any other sincere personal need.",
    ] },
    { p: "For a personal loan, a prior crowdfunding project is not required." },
    { p: "A person does not have to prove that the loan will generate a profit. Sometimes a person needs support simply so they can restore balance, step forward with ease, and re-enter the fullness of life." },

    { h: "A loan for a community project or business" },
    { p: "An unconditional loan can also be used to develop a business, a product, a service, or a project." },
    { p: "However, this is not about a classic business model whose main purpose is profit, company growth, or creating new jobs." },
    { p: "The businesses and projects that arise within Lana are meant for the expansion of the community and for the common good." },
    { p: "Their purpose can be:" },
    { ul: [
      "creating new products and services for the community,",
      "spreading the Lana economy,",
      "improving the quality of life,",
      "connecting people,",
      "caring for nature, animals, and people,",
      "spreading knowledge,",
      "creating new forms of cooperation,",
      "and inspiring others to also start creating from abundance.",
    ] },
    { p: "Such a project can of course also involve work, cooperation, and generating income, but its fundamental meaning is not classic employment of people or creating profit for oneself." },
    { p: "Its meaning is to create something that benefits the wider community." },

    { h: "Crowdfunding as the first step" },
    { p: "If an individual applies for a loan for a project or business, a crowdfunding project on the same topic must already have been carried out beforehand." },
    { p: "Crowdfunding is the first step, through which:" },
    { ul: [
      "the idea is presented to the community,",
      "people's response is tested,",
      "trust begins to be built,",
      "initial support is gathered,",
      "and it is shown that the individual is ready to actually begin developing the project.",
    ] },
    { p: "The unconditional loan is then not the start of a completely untested idea, but the next step of a project that has already begun its path in the community." },

    { h: "Eight days of maturing" },
    { p: "After it is submitted, every loan application enters a maturing period that lasts eight days." },
    { p: "During this time, community members have the opportunity to:" },
    { ul: [
      "read the introduction,",
      "sense the purpose of the loan,",
      "review the information provided,",
      "ask questions,",
      "and vote on the loan proposal.",
    ] },
    { p: "The purpose of maturing is not the classic assessment of a person or looking for reasons not to trust them." },
    { p: "The purpose is for the community to have time to truly see and feel the loan and to check how well it aligns with Lana's values." },
    { p: "During this period the applicant can supplement their application, answer questions, and clear up any concerns." },

    { h: "Voting through Lana Alignment" },
    { p: "Loans are voted on by people who have the right to take part in Lana Alignment votes." },
    { p: "For unconditional loans, the same voting-eligibility rules apply as for other referendums within Lana Alignment. This way we do not create a new, separate decision-making system, but instead include unconditional loans in the existing form of community alignment." },
    { p: "In the vote there are only two options:" },
    { ul: [
      "approve the loan,",
      "reject the loan.",
    ] },
    { p: "There is no neutral or in-between vote." },
    { p: "A person who rejects a loan can change their decision at any time during the maturing period." },
    { p: "This matters above all when the applicant:" },
    { ul: [
      "supplements missing information,",
      "answers a question,",
      "explains the purpose of the loan,",
      "clears up a misunderstanding,",
      "or in another way clarifies the reason for the rejection.",
    ] },
    { p: "Voting is not meant to be a final judgment of a person. It is a living process of alignment, in which one's stance toward a proposal can change once new information becomes available." },
    { p: "After eight days the referendum closes, and the result is determined according to the rules of Lana Alignment." },

    { h: "Loan disbursement" },
    { p: "An approved loan can be disbursed in two ways." },
    { h: "One-time disbursement" },
    { p: "The entire approved amount is paid out at once." },
    { p: "This is suitable when a person needs the funds immediately — for example, for a purchase, settling obligations, or carrying out a particular phase of a project." },
    { h: "Gradual disbursement" },
    { p: "The funds can be paid out gradually:" },
    { ul: [
      "at each Split,",
      "monthly,",
      "in other agreed periods,",
      "or upon reaching particular phases of the project.",
    ] },
    { p: "The method of disbursement is already defined in the loan application and is visible to the community during the maturing period." },

    { h: "Loan repayment" },
    { p: "An unconditional loan has no classic, rigidly fixed monthly installment." },
    { p: "An individual can repay it:" },
    { ul: [
      "through the funds they receive in Lana8Wonder,",
      "from the income of their project,",
      "through direct transfers,",
      "with smaller or larger voluntary payments,",
      "or in another way that their current situation allows.",
    ] },
    { p: "They can repay the loan in any amounts. At any time they can also pay it off in full ahead of schedule." },
    { p: "If they wish to return more to the community than they received, they can voluntarily overpay the loan. This surplus is not an interest rate, but a voluntary contribution to the shared fund from which future members will receive support." },

    { h: "What happens if the loan cannot be repaid?" },
    { p: "The unconditional nature of the loan truly shows itself when circumstances arise in life that make it objectively impossible for a person to return the funds." },
    { p: "If such a situation occurs, the loan does not have to be repaid." },
    { p: "Because of this a person does not become a debtor to the community in the classic sense, is not punished, and the debt does not become a burden that follows them through life." },
    { p: "This does not mean that a loan is taken from the start with the intention that it will not be repaid." },
    { p: "Everyone approaches it self-responsibly and with the sincere intention of returning it, when and if that is possible." },
    { p: "At the same time, Lana8Wonder creates a system through which people can, over time, receive funds and therefore, as a rule, also repay their loans. Repayment is thus a natural part of the circulation of abundance, not a coercion based on fear." },
    { p: "But if life shows otherwise, the person remains more important than the debt." },

    { h: "A dedicated account for each loan" },
    { p: "A separate dedicated account is created for each loan, on which the following are transparently visible:" },
    { ul: [
      "the approved amount,",
      "the purpose of the loan,",
      "the disbursement method,",
      "the funds already disbursed,",
      "the repayments made,",
      "any voluntary overpayments,",
      "the remaining amount,",
      "and the current status of the loan.",
    ] },
    { p: "This way, both the individual and the community can follow at all times how the funds are moving." },

    { h: "A living flow of community abundance" },
    { p: "When a loan is repaid, the funds do not come to an end." },
    { p: "They return to the shared fund and become support for the next person or project." },
    { p: "Someone receives the community's support today. Tomorrow, through their repayment, their actions, and their contribution, they can enable support for someone else." },
    { p: "An unconditional loan is therefore not only a financial tool." },
    { p: "It is a circulation of:" },
    { ul: [
      "trust,",
      "opportunity,",
      "responsibility,",
      "support,",
      "and abundance.",
    ] },
    { p: "The question is not whether a person is rich enough to be able to borrow money." },
    { p: "The question is whether we, as a community, are rich enough to be able to trust the person." },
  ],
};

export default function UnconditionalLoan() {
  const article = useLang() === "en" ? EN : SL;

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-3xl pb-24">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <HandCoins className="h-6 w-6 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{article.title}</h1>
          <p className="text-sm sm:text-base text-muted-foreground">{article.subtitle}</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-8 space-y-4 leading-relaxed">
          {article.blocks.map((block, i) => {
            if ("h" in block) {
              return (
                <h2 key={i} className="text-lg sm:text-xl font-semibold text-foreground pt-4 first:pt-0">
                  {block.h}
                </h2>
              );
            }
            if ("ul" in block) {
              return (
                <ul key={i} className="list-disc pl-6 space-y-1.5 text-muted-foreground marker:text-primary">
                  {block.ul.map((item, j) => (
                    <li key={j} className="leading-relaxed">{item}</li>
                  ))}
                </ul>
              );
            }
            return (
              <p key={i} className="text-muted-foreground">
                {block.p}
              </p>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
