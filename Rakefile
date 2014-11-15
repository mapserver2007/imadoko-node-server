# -*- coding: utf-8 -*-
require 'yaml'

config_files = [] # 環境変数が必要ならここに入れること
config = {'PRODUCTION' => true}
config_files.each do |file|
  file.each {|key, value| config[key] = value}
end

task:default => [:github_push, :heroku_deploy]

task :heroku_init do
  sh 'heroku create'
end

task :github_push do
  sh 'git push origin master'
end

task :heroku_deploy => [:github_push] do
  sh 'git push heroku master'
end

task :heroku_env => [:heroku_env_clean, :timezone] do
  config.each do |key, value|
    sh "heroku config:add #{key}=#{value}"
  end
end

task :heroku_pg_password_reset do
  sh "heroku pg:credentials HEROKU_POSTGRESQL_BLACK_URL --reset"
end

task :heroku_env_clean do
  config.each do |key, value|
    sh "heroku config:remove #{key}"
  end
end

task :timezone do
  sh "heroku config:add TZ=Asia/Tokyo"
end

task :heroku_psql do
  sh "heroku pg:psql"
end