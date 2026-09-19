# Iskorka BodyCore v1 — compact human physiology with sex-linked bodies

Status: concrete design before runtime implementation.
Branch: `design/body-human-physiology-v1`.
Primary references: BioGears LITE, JOS-3, current Iskorka body/sleep code.

## 1. Hard invariant: sex and body must never diverge

Current Iskorka data model has `AgentSex = 'male' | 'female'`. BodyCore must use that existing biological sex as the source of truth.

Rules:
- `agent.sex === 'male'` always creates/repairs a male reproductive body profile.
- `agent.sex === 'female'` always creates/repairs a female reproductive body profile.
- Reproductive anatomy is NEVER independently randomized.
- A save/reload cannot change body sex.
- A migrated body cannot silently switch its reproductive type.
- Individual height, mass, body fat, strength, endurance, pain sensitivity, sweating, fertility and other quantitative traits may vary deterministically within human ranges, but the reproductive body type remains consistent with `agent.sex`.
- Sex never assigns personality, intelligence, values, profession, social role, courage, curiosity, morality or agency.
- Adult sexual physiology is enabled only for adults (18+).
- Pregnancy can exist only on a female reproductive body.
- Male reproductive contribution and male refractory physiology can exist only on a male reproductive body.
- Sexual arousal and physical pleasure exist in both adult sexes and are not equivalent to fertility, consent, love, child desire or relationship status.

The ten founders remain exactly five male and five female agents. Their body phenotype must be created from those existing assignments, not re-rolled.

## 2. What BioGears LITE actually gives us

BioGears LITE explicitly models patient sex as `Male | Female` and stores anthropometric/system baselines including age, weight, height, body density, body fat fraction, lean mass, muscle mass, max work rate, skin surface area, pain susceptibility, basal metabolic rate, blood volume baseline, heart-rate baseline and respiratory capacities.

Its system code provides useful causal references for:
- Energy: core/skin temperature, metabolic rate, exercise, fatigue, sweating, water and sodium/potassium/chloride loss.
- Cardiovascular: blood volume, heart-rate/pressure response, metabolic and thermal vascular response.
- Respiratory: O2/CO2, ventilation, respiratory drive and pain/exertion effects.
- Renal: urine production, bladder/urinary compartments, sodium/potassium and fluid regulation.
- Endocrine: epinephrine response to exercise, stress/pain, insulin and glucagon.
- Nervous: baroreceptor/chemoreceptor feedback, pain, pupil response and respiratory control.
- Gastrointestinal: stomach contents, nutrient and water absorption.
- Tissue/Blood Chemistry: O2 consumption, CO2 production, nutrient metabolism, fluid mass, blood chemistry and fatigue.

Important limit: BioGears LITE is a medical physiology reference, not the complete Iskorka reproductive/emotional body. We do not copy its continuous solver.

## 3. Body layout

Body state has four layers:

1. Existing `V21BodyState.systems` — integral health of major systems.
2. `BodyPhenotypeV1` — small, mostly immutable individual physical profile.
3. `BodyCoreV1` — compact dynamic homeostasis.
4. `SexBodyStateV1` + sparse active states — reproductive physiology, wounds, diseases, pregnancy/postpartum, etc.

### 3.1 Existing system-health values

Keep current:
- skin
- musculoskeletal
- circulatory
- respiratory
- digestive
- nervous
- immune

Add when BodyCore implementation begins:
- endocrine
- renal
- reproductive
- sensory

These are health/capacity values, not detailed organ simulations.

## 4. BodyPhenotypeV1 — immutable/slow individual traits

Do NOT store values that can be derived cheaply from these.

Persist only:
1. `heightM`
2. `massKg`
3. `bodyFatFraction`
4. `painSensitivity`
5. `sweatSensitivity`
6. `motionSicknessSensitivity`

Derived, not persistently duplicated:
- lean mass
- approximate muscle mass
- body surface area
- blood volume baseline
- basal metabolic rate
- lung-capacity scale
- heat capacity
- resting heart-rate target
- resting respiratory target
- work-capacity target

Generation:
`phenotype = deterministic(seed, agent.id, agent.sex, age)`.

The deterministic generator uses sex-aware statistical baselines but allows large overlap between individuals. Sex provides physiological baseline equations and reproductive anatomy; it does not force stereotyped non-reproductive traits.

## 5. BodyCoreV1 — dynamic values that deserve persistent state

Target: 26 hot numeric values per active body.

### Fluid / nutrition
1. `hydration` — usable body-water state.
2. `electrolyteDeviation` — signed coarse water/salt imbalance.
3. `energyReserve` — available longer-term metabolic reserve.
4. `stomachFill` — current intake awaiting digestion/absorption.
5. `bladderFill` — urine accumulation/urge source.
6. `bowelLoad` — coarse lower-GI accumulation/urge source.

### Thermal / circulation / respiration
7. `coreTemperatureC`
8. `skinTemperatureC`
9. `bloodVolumeFraction` — 1.0 = individual baseline.
10. `oxygenDebt` — aggregate unmet oxygen demand.
11. `cardiovascularLoad`
12. `respiratoryLoad`

### Physical load / recovery
13. `exertionDebt`
14. `muscleFatigue`
15. `recoveryDebt`

### Injury / sickness
16. `pain` — reuse/replace current body pain, do not duplicate it.
17. `inflammation`
18. `immuneActivation`
19. `toxinLoad`
20. `nausea`
21. `dizziness`

### Autonomic / interoceptive bridge
22. `autonomicArousal`
23. `muscleTension`
24. `stressHormoneLoad`
25. `tearDrive`
26. `physicalPleasure`

### Adult-only common extension
27. `sexualArousal`

This field exists only/activates for adult physiology. It is a body signal, never a decision.

Values such as physical discomfort, thirst, hunger, breathlessness, weakness, sweating, tremor, blushing, goosebumps, heart-rate sensation, pupil arousal, dry mouth, startle, post-stress relaxation and post-pleasure relaxation are derived on demand rather than stored separately.

## 6. SexBodyStateV1

Use a discriminated union tied to `agent.sex`.

```ts
type SexBodyStateV1 =
  | {
      type: 'male';
      reproductiveHealth: number;
      refractoryLoad: number;
    }
  | {
      type: 'female';
      reproductiveHealth: number;
      cyclePhase: number; // 0..1 across an individual adult ovarian cycle
      pregnancy?: PregnancyBodyStateV1;
      postpartum?: PostpartumBodyStateV1;
    };
```

### Male reproductive body
Physical functions:
- male reproductive anatomy is implicit in `type: 'male'`;
- sperm-producing fertility is derived from reproductive health + age + overall health;
- adult sexual arousal;
- generalized genital response;
- climax/ejaculatory event when the adult voluntary interaction reaches that physical state;
- refractory/recovery load;
- fertility decreases with serious illness, starvation, dehydration, injury and reproductive aging.

Do not create a per-tick sperm simulation. No need to persist "sperm count" for ordinary life.

### Female reproductive body
Physical functions:
- female reproductive anatomy is implicit in `type: 'female'`;
- ovarian-cycle phase;
- fertile window derived from phase + reproductive health + age;
- menstruation effects derived from cycle phase rather than a permanent extra timer when possible;
- adult sexual arousal;
- generalized genital response/lubrication as derived physical response;
- climax/physical pleasure as physiological events;
- conception only from compatible adult reproductive interaction;
- pregnancy as sparse active state;
- childbirth;
- postpartum recovery;
- lactation only if infant feeding is actually simulated;
- reproductive aging/menopause derived from age and reproductive health.

Do not assign pregnancy/cycle/uterine functions to a male body through random traits.

## 7. Sparse female pregnancy state

Pregnancy is NOT part of every body's hot loop.

Only while pregnant:
- conceptionWorldMinute
- dueWorldMinute
- expectedChildCount
- pregnancyHealth
- complicationLoad
- maternalLoad

Gestational progress is derived from absolute world time. We do not tick a fetus every minute.

Postpartum is also sparse:
- startedWorldMinute
- recoveryLoad
- optional lactation state if infant feeding requires it.

## 8. Derived signals — large functionality from small state

Examples:

`thirst = f(hydration, electrolyteDeviation, coreTemperature, exertion, illness)`

`hunger = f(energyReserve, stomachFill, activity, fever, pregnancy)`

`breathlessness = f(respiratoryLoad, oxygenDebt, respiratoryHealth, exertion, fearArousal)`

`weakness = f(energyReserve, hydration, bloodVolumeFraction, oxygenDebt, illness, muscleFatigue)`

`sweating = f(coreTemperature, skinTemperature, exertion, autonomicArousal, sweatSensitivity, hydration)`

`tremor = max(coldStress, fearArousal*sensitivity, feverChill, exhaustion)`

`crying = f(tearDrive, grief, pain, fear, joyPeak, personalitySuppression)`

`physicalDiscomfort = f(pain, nausea, thermalStress, bladderUrge, bowelUrge, breathlessness, fatigue)`

`postPleasureRelaxation = f(recentPhysicalPleasure, fallingAutonomicArousal)`

`fertilityMale = f(reproductiveHealth, age, illness, starvation, dehydration)`

`fertilityFemale = f(reproductiveHealth, age, cyclePhase, pregnancy/postpartum state, illness, starvation, dehydration)`

## 9. Emotion ↔ body bridge

Mind → body:
- fear: autonomic arousal, cardiovascular/respiratory load, muscle tension, sweat/tremor/startle;
- grief: tear drive, breathing disturbance, low physical activation;
- joy: relaxed tension, laughter/smile expression, positive pleasure background;
- awe: autonomic spike/goosebumps/breath change;
- stress: stress-hormone load, tension, dry mouth, sleep-quality pressure.

Body → mind:
- pain, thirst, hunger, breathlessness, heat/cold, nausea, dizziness and weakness become salience signals;
- physical pleasure provides positive body valence;
- sexual arousal is reported to the mind but cannot choose intimacy;
- bodily safety/relaxation lowers threat salience but does not create trust/love by itself.

## 10. Sex-linked initialization

### Founders
Current Iskorka already enforces five `male` and five `female` founders.

Body creation must:
1. read `agent.sex`;
2. generate phenotype from `seed + agent.id + sex`;
3. create matching `SexBodyStateV1`;
4. assert body/agent sex consistency.

No random "pick body type".

### Newborns
When the world creates a new child:
1. existing world logic chooses the child's `AgentSex` deterministically from world RNG;
2. BodyCore reads that result;
3. creates matching physical sex body;
4. stores no adult sexual state until adulthood;
5. age-dependent physical development can alter size/composition/endurance gradually.

The sex RNG and the body RNG must not be separate decisions.

## 11. Sex-linked baseline differences without stereotypes

Permitted biological baseline differences:
- reproductive anatomy and function;
- body-composition baseline distributions;
- adult muscle/fat distribution factors;
- blood-volume/BMR/lung-capacity equations where they derive from body size/composition and sex-specific physiology;
- reproductive endocrine patterns;
- pregnancy/childbirth/lactation;
- adult refractory/cycle physiology;
- reproductive aging.

Not permitted as sex defaults:
- intelligence;
- curiosity;
- courage;
- diligence;
- empathy;
- values;
- profession;
- social status;
- combat desire;
- family desire;
- sexual consent/interest.

Those remain individual mind/experience variables.

## 12. Scheduler / performance

Hot active body:
- movement/load integration can update with existing physical movement cadence;
- autonomic impulses update only when active;
- homeostasis updates on coarse physiological cadence;
- disease/wound healing updates much less frequently;
- reproductive cycle uses absolute world time, not minute ticks;
- pregnancy progress uses absolute world time;
- off-screen bodies use analytic catch-up;
- sleeping bodies reuse existing BodySleepV21 and coarse physiological integration.

No loop over organs. No heartbeat ticks. No breath ticks. No menstrual minute ticks.

## 13. Runtime invariants/tests required before merge

1. Founder count: exactly 5 male bodies + 5 female bodies.
2. Every male agent has male SexBodyState; every female agent has female SexBodyState.
3. No female-only reproductive state on a male body.
4. No male-only reproductive state on a female body.
5. Child body sex equals child agent.sex.
6. Save/reload preserves phenotype and sex state byte-for-byte/semantically.
7. Same seed creates same bodies.
8. Different agents of same sex are not clones.
9. Sex never changes personality/values/skills.
10. Existing sleep tests still pass unchanged.
11. BodyCore disabled/inactive adult fields do not appear in minors.
12. Pregnancy/cycle work through absolute world time and do not add high-frequency loops.
13. Long catch-up produces the same bounded physiological outcome class as stepped time within defined tolerances.
14. Performance benchmark records cost per 100 / 1,000 / 10,000 bodies before enabling the system globally.

## 14. Memory target

Ordinary non-pregnant adult:
- 6 slow phenotype scalars;
- 7 existing system-health scalars initially, expanding to 11;
- 27 BodyCore dynamic scalars;
- 2 sex-body scalars (male) or 2–3 female reproductive scalars;
- sparse wounds/diseases only when present.

Implementation should prefer compact nested structures or numeric arrays in hot paths instead of many tiny JS objects.

The target is not "medical solver accuracy per heartbeat". The target is human-like causal behavior across many years with enough physiological truth that body state changes choices and experience.


## 15. Реализованный слой Body Physiology + Mind Bridge

Статус: реализовано в `src/iskorka/BodyPhysiologyV1.ts`.

### Тело живёт во времени аналитически
Без микротиков сердца/дыхания обновляются:
- гидратация и грубый водно-солевой баланс;
- желудочная наполненность и энергетический резерв;
- мочевой пузырь и кишечная нагрузка;
- температура ядра и кожи;
- объём крови;
- кислородный долг;
- нагрузка кровообращения и дыхания;
- физическая нагрузка, мышечная усталость и долг восстановления;
- воспаление и иммунная активация;
- тошнота и головокружение;
- вегетативное возбуждение;
- мышечное напряжение;
- стрессовый гормональный фон;
- позыв к слезам;
- физическое удовольствие;
- взрослое сексуальное возбуждение;
- мужское рефрактерное восстановление;
- женская беременность/послеродовая нагрузка;
- репродуктивное здоровье.

### Разум → тело
- fear/stress/pain повышают autonomic arousal, напряжение, сердечно-дыхательную нагрузку и стрессовый гормональный фон;
- grief/fear/pain и пик сильной радости формируют tearDrive;
- awe может давать мурашки;
- нагрузка тела усиливает вегетативную реакцию;
- сон остаётся существующей отдельной системой и только снижает телесную нагрузку/восстановительный долг.

### Тело → разум
Из BodyCore вычисляются:
- thirst;
- hunger;
- breathlessness;
- weakness;
- cold/heat stress;
- sweating;
- tremor;
- heart pounding;
- bladder/bowel urge;
- physical discomfort;
- crying drive;
- tears;
- blushing;
- goosebumps;
- dry mouth;
- startle;
- physical pleasure;
- adult sexual arousal;
- post-pleasure relaxation.

Эти сигналы:
- слегка изменяют stress/fear/joy/hope;
- увеличивают salience целей recover и secure_resources;
- никогда сами не выбирают действие.

### Взрослая добровольная близость
После уже принятого обоими взрослыми решения тело получает физическую реакцию:
- sexual arousal;
- physical pleasure;
- autonomic response;
- post-pleasure relaxation;
- у мужского профиля — refractory load.

Физическое удовольствие может дать краткий положительный телесный feedback в joy/stress, но не создаёт автоматически любовь, доверие, согласие, желание ребёнка, ценности или отношения.

### Производительность
- один аналитический расчёт на существующую семантическую границу;
- decay/approach по `elapsedWorldMinutes`;
- нет heartbeat/breath/fetus minute loops;
- сигналы в основном derived, не persisted;
- текущая проверка: 58/58 тестов, standalone build проходит.
