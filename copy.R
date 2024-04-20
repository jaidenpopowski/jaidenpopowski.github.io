
#rmarkdown::render_site()

file.copy(
  from = paste0("C:/Users/jpopo/Documents/Rstats/rWebsite/docs/",list.files(path = "C:/Users/jpopo/Documents/Rstats/rWebsite/docs")),
  to = "C:/Users/jpopo/Documents/GitHub/jaidenpopowski.github.io",
  overwrite = T
  )
