# biller

> Split utility bills with your roommate, ACCURATELY

## Supported bill split modes

- `per-person-per-day`
- `per-family-per-day`
- `per-person`
- `per-family`

## Configuration

**You must properly configure `biller` to use it.**

1. Suppose 5 people from 3 families rent an apartment:

    ```yaml
    families:
      W&E:
        persons: [ Willow, Emersyn ]
      M&M:
        persons: [ Mckenna, Mia ]
      S:
        persons: [ Steven ]
    ```

2. And they need to pay 2 utilities and rent:

    ```yaml
    bills:
      - desc: water
        mode: per-person-per-day
      - desc: internet
        mode: per-family-per-day
      - desc: insurance
        mode: per-person
      - desc: rent
        mode: per-family
    ```

    - Water usage is proportional to number of people occupied as well as duration of stay, so they shall use `per-person-per-day`.
    - Families watch TV together, so internet connectivity is proportional to number of families as well as duration of stay. That's the case for `per-family-per-day`.
    - Risks linked to their rental insurance is proportional to how many people lived there, regardless of how long they stayed. So `per-person` is used.
    - If any person from a family lived in the apartment for any time, that person shall be responsible for the area (bedroom and shared living room) they occupied, regardless of how long they stayed there. In this situation `per-family` is mostly applicable.

3. Finally, they all shall maintain a journal of who is currently living there:

    ```yaml
    activities:
      # nobody was there before that
      20220101: { Willow: +1, Emersyn: +1 } # Moving in
      20220105: { Mia: +1, Steven: +1 } # Moving in
      20220110: { Willow: -1 } # Moving out
      20220115: { Mia: 0 } # temporarily not home on that day
      20220116: { Mia: 0 } # temporarily not home on that day
    ```

## Usage

1. Name configuration file as `data.yaml` and put it in working directory.
2. Run `npx biller`, and follow the prompt:

    <pre>
    <b>$> npx biller</b>
    List of bills:
    [0]: water - per-person-per-day
    [1]: internet - per-family-per-day
    [2]: rent - per-family

    Which bill to generate? <b>0</b>
    Bill start date (incl.)? (YYYYMMDD) <b>20220101</b>
    Bill end date (incl.)? (YYYYMMDD) <b>20220131</b>
    Amount? <b>33.12</b>
    Duration is 31 days, right? <b>(just press enter)</b>
    ========================
    ==== SHARES REPORT =====
    ========================
    water bill: 20220101~20220131(31d) 33.12
    20220101~20220104(4d): Willow, Emersyn
    20220105~20220109(5d): Willow, Emersyn, Mia, Steven
    20220110~20220114(5d): Emersyn, Mia, Steven
    20220115~20220116(2d): Emersyn, Steven
    20220117~20220131(15d): Emersyn, Mia, Steven
    water per person per day: $33.12/(4*2+5*4+5*3+2*2+15*3)=$0.36
    W&E: $0.36*(4*2+5*2+5*1+2*1+15*1)=$14.4
    M&M: $0.36*(5*1+5*1+15*1)=$9
    S: $0.36*(5*1+5*1+2*1+15*1)=$9.72
    </pre>
