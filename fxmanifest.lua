fx_version 'cerulean'
game 'gta5'
lua54 'yes'

author 'Firgyy'
description 'Script de gestion des stashes pour admin'
version '1.0.0'

escrow_ignore {
    'config.lua',
    'client.lua',
    'server.lua',
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js',
    'stashes.json',
}

shared_script {
    '@es_extended/imports.lua',
    'config.lua',
}

client_scripts {
    'client.lua',
}

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'server.lua',
}

-- Dépendance optionnelle pour LfInteract
dependency 'LfInteract'