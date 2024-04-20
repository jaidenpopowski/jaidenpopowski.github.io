# AFL Player Stats

library(fitzRoy)
library(tidyverse)
library(httr)
library(jsonlite)
library(jsonify)
library(lubridate)

age <- function(dob, age.day = today(), units = "years", floor = TRUE) {
  calc.age = lubridate::interval(dob, age.day) / lubridate::duration(num = 1, units = units)
  if (floor) return(as.integer(floor(calc.age)))
  return(calc.age)
}

aflw_details <-
  purrr::map_dfr(
    c(2017:2022,2101,2023),
    ~ content(
      GET(
        paste0('https://api.afl.com.au/statspro/playersStats/seasons/CD_S',.x,'264'),
        config = httr::add_headers("x-media-mis-token" = fitzRoy::get_afl_cookie())
      ),as = 'text',encoding = 'UTF-8') %>%
      jsonlite::fromJSON(flatten = T) %>% .[['players']] %>% mutate(season = .x)) %>% 
  mutate(
  playerDetails.surname = str_replace(playerDetails.surname, "^Pelton$","Pregelj"),
  playerDetails.dateOfBirth = ifelse(playerId == "CD_I1019061","22/08/1991",playerDetails.dateOfBirth))

# AFLW Player Profile - Details

create_player_data <- function(group) {
  
  # Select and flatten data columns
  data <- group %>%
    select(-c(playerId:careerGoals)) %>%
    # Use purrr::map to iterate over columns and create key-value pairs
    purrr::map(~list(.x= .)) %>%
    # Combine into a single list
    purrr::reduce(., list, c)
  
  return(list(
    Seasons = data,
    Details = list(playerName = group$playerName[1], currentAge = group$currentAge[1], height = group$height[1], lastSeason = group$lastSeason[1], careerGames = group$careerGames[1], careerGoals = group$careerGoals[1])
  ))
}

aflw_player_profiles <- aflw_details %>% 
  group_by(season,team.teamName) %>% 
  mutate(cbas = round((max(gamesPlayed)/gamesPlayed) *400*totals.centreBounceAttendances/sum(totals.centreBounceAttendances,na.rm=T),1)) %>% 
  ungroup() %>% 
  mutate(cbas = ifelse(cbas>100,100,cbas)) %>% 
  mutate(age = age(dob = as.Date(playerDetails.dateOfBirth,tryFormats = "%d/%M/%Y"), age.day = paste0(ifelse(season == 2101, 2022, season), "/12/31"))) %>% 
  mutate(season = case_match(season,2101 ~ "2022B",2022 ~ "2022A",.default = as.character(season))) %>% 
  transmute(
    playerId = parse_number(playerId),
    playerName = paste(playerDetails.givenName,playerDetails.surname),
    currentAge = playerDetails.dateOfBirth,
    height = playerDetails.heightCm,
    season,
    team = team.teamAbbr,
    age,
    games = gamesPlayed,
    fantasy = averages.dreamTeamPoints,
    time_on_ground = averages.timeOnGroundPercentage,
    # possessions
    possessions = averages.totalPossessions,
    # contested
    contested = averages.contestedPossessions,
    groundball = averages.groundBallGets,
    adv_receives = round((totals.contestedPossessions - totals.freesFor - totals.groundBallGets - totals.contestedMarks)/gamesPlayed,1),
    # uncontested
    uncontested = averages.uncontestedPossessions,
    gathers = uncontested - (averages.marks - averages.contestedMarks),
    intercept_poss = averages.intercepts - averages.interceptMarks,
    # clearance
    cba = round(totals.centreBounceAttendances/gamesPlayed,1),
    cba_pc = cbas,
    clearances = averages.totalClearances,
    centre_clr = averages.centreClearances,
    stoppage_clr = averages.stoppageClearances,
    # disposals
    disposals = averages.disposals,
    eff_disp = averages.effectiveDisposals,
    disp_efcy = round(100*totals.effectiveDisposals/totals.disposals,1),
    handballs = averages.handballs,
    handball_efcy = round(100*(totals.effectiveDisposals - totals.effectiveKicks)/(totals.disposals-totals.kicks),1),
    kicks = averages.kicks,
    kick_efcy = round(100*totals.effectiveKicks/totals.kicks,1),
    kick_hb_ratio = round(totals.kicks/totals.handballs,1),
    clangers = averages.clangers - averages.freesAgainst,
    # movement
    metres = averages.metresGained,
    metres_per_disp = round(totals.metresGained/totals.disposals,1),
    kickins = averages.kickins,
    kickin_playon_rate = round(100*totals.kickinsPlayon/totals.kickins,1),
    rebounds = averages.rebound50s,
    inside_50s = averages.inside50s,
    bounces = averages.bounces,
    # marks
    marks = averages.marks,
    contested_marks = averages.contestedMarks,
    lead_marks = averages.marksOnLead,
    uncontested_marks = marks - contested_marks - lead_marks,
    intercept = averages.interceptMarks,
    marks_F50 = averages.marksInside50,
    # scoring
    shots = totals.shotsAtGoal,
    goals = totals.goals,
    behinds = totals.behinds,
    score = 6*goals + 1*behinds,
    goal_assists = totals.goalAssists,
    involvements = averages.scoreInvolvements,
    launches = averages.scoreLaunches,
    # defence
    tackles = averages.tackles,
    tackles_in50 = averages.tacklesInside50,
    pressure = averages.pressureActs,
    pressure_def = averages.defHalfPressureActs,
    pressure_fwd = pressure - pressure_def,
    spoils = averages.spoils,
    one_percenters = averages.onePercenters,
    # one on one
    ooo_def = averages.contestDefOneOnOnes,
    ooo_def_loss = averages.contestDefLosses,
    ooo_def_loss_rate = round(100*totals.contestDefLosses/totals.contestDefOneOnOnes,1),
    ooo_off = averages.contestOffOneOnOnes,
    ooo_off_win = averages.contestOffWins,
    ooo_off_win_rate = round(100*totals.contestOffWins/totals.contestOffOneOnOnes,1),
    # frees
    frees_for = averages.freesFor,
    frees_against = averages.freesAgainst,
    free_diff = averages.freesFor - averages.freesAgainst,
    # ruck
    ruck_contests = averages.ruckContests,
    hitouts = averages.hitouts,
    hitout_win = round(100*totals.hitouts/totals.ruckContests,1),
    hitouts_adv = averages.hitoutsToAdvantage,
    adv_rate = round(100*totals.hitoutsToAdvantage/totals.hitouts,1)
  ) %>% 
  group_by(playerId) %>% 
  mutate(
    playerName = last(playerName),
    currentAge = age(dob=as.Date(last(currentAge),tryFormats = "%d/%m/%Y")),
    height = last(height),
    lastSeason = last(season),
    careerGames = sum(games,na.rm=T),
    careerGoals = sum(goals,na.rm=T)
  ) %>% 
  ungroup() %>% 
  select(playerId,playerName,currentAge,height,lastSeason,careerGames,careerGoals,everything()) %>% 
  arrange(desc(season))

purrr::map(sort(unique(aflw_player_profiles$playerId)),
           ~ list("Details" = distinct(aflw_player_profiles[aflw_player_profiles$playerId == .x, 2:7]),"Seasons" = aflw_player_profiles[aflw_player_profiles$playerId == .x, -c(1:7)])) %>% 
  setNames(sort(unique(aflw_player_profiles$playerId))) %>% 
  jsonlite::toJSON(dataframe = "columns",auto_unbox = T) %>% 
  write_file(file = "data/aflw/aflw_player_profiles.json")
