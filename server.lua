-- ================================================================
-- LfStashes - Server Script
-- Système de gestion des stashes pour ESX & ox_inventory
-- ================================================================

-- Variables globales
ESX = exports['es_extended']:getSharedObject()

-- Variables locales
local resourceName = GetCurrentResourceName()
local stashesCache = {}

--- Supprime les données d'un stash dans la table ox_inventory
---@param stashName string
local function clearOxInventory(stashName)
    if not stashName or stashName == '' then return end
    MySQL.Async.execute('DELETE FROM ox_inventory WHERE name = @name', {
        ['@name'] = stashName
    })
end

-- ================================================================
-- Fonctions utilitaires
-- ================================================================

--- Vérifie si une table est un tableau
---@param tbl table
---@return boolean
local function isArray(tbl)
    if type(tbl) ~= 'table' then return false end
    local count = 0
    for k in pairs(tbl) do
        if type(k) ~= 'number' then
            return false
        end
        count = count + 1
    end
    return count == #tbl
end

--- Encode une table en JSON formaté (pretty print)
---@param value any
---@param indent string
---@return string
local function encodePretty(value, indent)
    indent = indent or ''
    local nextIndent = indent .. '  '

    local valueType = type(value)
    if valueType == 'table' then
        if next(value) == nil then
            return (isArray(value) and '[]' or '{}')
        end

        if isArray(value) then
            local parts = {'['}
            for i = 1, #value do
                parts[#parts + 1] = nextIndent .. encodePretty(value[i], nextIndent)
                if i < #value then
                    parts[#parts] = parts[#parts] .. ','
                end
            end
            parts[#parts + 1] = indent .. ']'
            return table.concat(parts, '\n')
        else
            local keys = {}
            for k in pairs(value) do
                keys[#keys + 1] = k
            end
            table.sort(keys, function(a, b)
                return tostring(a) < tostring(b)
            end)

            local parts = {'{'}
            for i = 1, #keys do
                local key = keys[i]
                parts[#parts + 1] = string.format('%s"%s": %s', nextIndent, key, encodePretty(value[key], nextIndent))
                if i < #keys then
                    parts[#parts] = parts[#parts] .. ','
                end
            end
            parts[#parts + 1] = indent .. '}'
            return table.concat(parts, '\n')
        end
    elseif valueType == 'string' then
        return string.format('%q', value)
    elseif valueType == 'number' or valueType == 'boolean' then
        return tostring(value)
    elseif value == nil then
        return 'null'
    end

    return 'null'
end

local function trim(str)
    if type(str) ~= 'string' then
        return ''
    end
    return (str:gsub('^%s*(.-)%s*$', '%1'))
end

local function sanitizePersonalMembers(raw)
    local members = {}
    if type(raw) ~= 'table' then
        return members
    end

    local dedupe = {}
    for _, entry in ipairs(raw) do
        local identifier
        local displayName = ''

        if type(entry) == 'table' then
            identifier = entry.identifier or entry.id or entry.value
            displayName = entry.displayName or entry.name or entry.label or ''
        elseif type(entry) == 'string' then
            identifier = entry
        end

        if type(identifier) == 'string' then
            identifier = trim(identifier)
            if identifier ~= '' and not dedupe[identifier] then
                dedupe[identifier] = true
                if type(displayName) == 'string' then
                    displayName = trim(displayName)
                else
                    displayName = ''
                end
                members[#members + 1] = {
                    identifier = identifier,
                    displayName = displayName
                }
            end
        end
    end

    return members
end

local function escapeLike(str)
    if type(str) ~= 'string' then
        return ''
    end
    local escaped = str:gsub('\\', '\\\\'):gsub('%%', '\\%%'):gsub('_', '\\_')
    return escaped
end

--- Charge les stashes depuis le fichier JSON
local function loadStashesFromFile()
    local data = LoadResourceFile(resourceName, 'stashes.json')
    if not data or data == '' then
        stashesCache = {}
        return
    end
    
    local ok, decoded = pcall(json.decode, data)
    if ok and type(decoded) == 'table' then
        stashesCache = decoded
    else
        stashesCache = {}
    end

    -- Initialiser les données pour chaque type de stash
    for i = 1, #stashesCache do
        local stash = stashesCache[i]
        if stash.ownerType == 'crew' then
            stash.crewMembers = stash.crewMembers or {}
            stash.crewGradeRang = stash.crewGradeRang and tonumber(stash.crewGradeRang) or nil
            stash.personalMembers = nil
        elseif stash.ownerType == 'personal' then
            stash.personalMembers = sanitizePersonalMembers(stash.personalMembers)
            stash.crewMembers = nil
            stash.crewGradeRang = nil
        elseif stash.ownerType == 'job' then
            -- S'assurer que le grade est toujours défini (0 par défaut) pour les stashes de métier
            stash.jobGrade = tonumber(stash.jobGrade) or 0
            stash.crewMembers = nil
            stash.crewGradeRang = nil
            stash.personalMembers = nil
        else
            stash.crewMembers = nil
            stash.crewGradeRang = nil
            stash.personalMembers = nil
        end
    end
end

--- Sauvegarde les stashes dans le fichier JSON
local function saveStashesToFile()
    local encoded = encodePretty(stashesCache, '')
    if not encoded or encoded == '' then
        encoded = '[]'
    end
    SaveResourceFile(resourceName, 'stashes.json', encoded .. '\n', -1)
end

--- Enregistre un stash avec ox_inventory
---@param stash table
local function registerStashWithOx(stash)
    local groups = nil
    local owner = false

    if stash.ownerType == 'job' and stash.jobName then
        groups = { [stash.jobName] = tonumber(stash.jobGrade or 0) or 0 }
    end

    exports.ox_inventory:RegisterStash(
        stash.id,
        stash.label,
        tonumber(stash.slots) or 50,
        tonumber(stash.weight) or 100000,
        owner,
        groups
    )
end

--- Vérifie si un joueur est administrateur
---@param xPlayer table
---@return boolean
local function isAdmin(xPlayer)
    local group = xPlayer.getGroup()
    return group == Config.AdminGroup or group == 'superadmin' or group == '_dev'
end

--- Récupère les membres d'un crew depuis la base de données
---@param crewId number
---@param callback function
local function fetchCrewMembers(crewId, callback)
    MySQL.Async.fetchAll('SELECT identifier FROM crew_membres WHERE id_crew = @id', {
        ['@id'] = crewId
    }, function(rows)
        local members = {}
        if rows then
            for _, row in ipairs(rows) do
                if row.identifier then
                    table.insert(members, row.identifier)
                end
            end
        end
        callback(members)
    end)
end

--- Récupère le rang du grade du joueur dans un crew
---@param identifier string
---@param crewId number
---@param callback function
local function fetchPlayerCrewGradeRang(identifier, crewId, callback)
    if not Config.UseTerritory then
        callback(nil)
        return
    end
    
    MySQL.Async.fetchAll([[
        SELECT cg.rang 
        FROM crew_membres cm 
        JOIN crew_grades cg ON cm.id_grade = cg.id_grade 
        WHERE cm.identifier = @identifier AND cm.id_crew = @crewId
        LIMIT 1
    ]], {
        ['@identifier'] = identifier,
        ['@crewId'] = tonumber(crewId)
    }, function(rows)
        if rows and rows[1] and rows[1].rang then
            callback(tonumber(rows[1].rang))
        else
            callback(nil)
        end
    end)
end

--- Rafraîchit les stashes pour tous les clients
---@param excludeSource number|nil Source à exclure (optionnel)
local function refreshAllClients(excludeSource)
    for _, playerId in ipairs(GetPlayers()) do
        if not excludeSource or tonumber(playerId) ~= excludeSource then
            TriggerClientEvent('lfstashes:refreshStashes', playerId)
        end
    end
end

-- ================================================================
-- Events handlers
-- ================================================================

--- Charger les stashes au démarrage du serveur
AddEventHandler('onServerResourceStart', function(res)
    if res == resourceName or res == 'ox_inventory' then
        loadStashesFromFile()
        for _, stash in ipairs(stashesCache) do
            if stash.ownerType == 'crew' then
                stash.crewMembers = stash.crewMembers or {}
            end
            registerStashWithOx(stash)
        end
    end
end)

-- ================================================================
-- Callbacks ESX
-- ================================================================

--- Callback pour obtenir la liste des métiers
ESX.RegisterServerCallback('lfstashes:getJobsList', function(source, cb)
    MySQL.Async.fetchAll('SELECT name, label FROM jobs', {}, function(result)
        cb(result or {})
    end)
end)

--- Callback pour obtenir les grades d'un métier
ESX.RegisterServerCallback('lfstashes:getJobGrades', function(source, cb, jobName)
    MySQL.Async.fetchAll('SELECT grade, label FROM job_grades WHERE job_name = @job_name ORDER BY grade ASC', {
        ['@job_name'] = jobName
    }, function(result)
        cb(result or {})
    end)
end)

--- Callback pour obtenir la liste des crews
ESX.RegisterServerCallback('lfstashes:getCrewsList', function(source, cb)
    -- Si UseTerritory est désactivé, retourner une liste vide
    if not Config.UseTerritory then
        cb({})
        return
    end
    
    MySQL.Async.fetchAll('SELECT id_crew, name FROM crew_liste', {}, function(result)
        cb(result or {})
    end)
end)

--- Callback pour obtenir les grades d'un crew
ESX.RegisterServerCallback('lfstashes:getCrewGrades', function(source, cb, crewId)
    -- Si UseTerritory est désactivé, retourner une liste vide
    if not Config.UseTerritory then
        cb({})
        return
    end
    
    if not crewId then
        cb({})
        return
    end
    
    -- Récupérer les grades triés par rang (rang le plus élevé = grade le plus bas en premier)
    MySQL.Async.fetchAll('SELECT id_grade, name, rang FROM crew_grades WHERE id_crew = @id_crew ORDER BY rang DESC', {
        ['@id_crew'] = tonumber(crewId)
    }, function(result)
        cb(result or {})
    end)
end)

--- Callback pour obtenir tous les stashes
ESX.RegisterServerCallback('lfstashes:getStashes', function(source, cb)
    loadStashesFromFile()
    cb(stashesCache or {})
end)

ESX.RegisterServerCallback('lfstashes:searchPlayers', function(source, cb, query)
    local xPlayer = ESX.GetPlayerFromId(source)
    if not xPlayer or not isAdmin(xPlayer) then
        cb({})
        return
    end

    if type(query) ~= 'string' then
        cb({})
        return
    end

    query = trim(query)
    if #query < 3 then
        cb({})
        return
    end

    local pattern = '%' .. escapeLike(query) .. '%'

    MySQL.Async.fetchAll([[
        SELECT identifier, firstname, lastname
        FROM users
        WHERE identifier LIKE @pattern ESCAPE '\\'
           OR CONCAT(firstname, ' ', lastname) LIKE @pattern ESCAPE '\\'
           OR CONCAT(lastname, ' ', firstname) LIKE @pattern ESCAPE '\\'
        LIMIT 20
    ]], {
        ['@pattern'] = pattern
    }, function(rows)
        local results = {}
        if rows then
            for _, row in ipairs(rows) do
                if row.identifier then
                    local firstname = trim(row.firstname or '')
                    local lastname = trim(row.lastname or '')
                    local fullname = ''

                    if firstname ~= '' then
                        fullname = firstname
                    end

                    if lastname ~= '' then
                        if fullname ~= '' then
                            fullname = fullname .. ' ' .. lastname
                        else
                            fullname = lastname
                        end
                    end

                    results[#results + 1] = {
                        identifier = row.identifier,
                        displayName = fullname ~= '' and fullname or row.identifier
                    }
                end
            end
        end

        cb(results)
    end)
end)

-- ================================================================
-- Events réseaux
-- ================================================================

--- Event pour créer un nouveau stash
RegisterNetEvent('lfstashes:createStash', function(data)
    local _source = source
    local xPlayer = ESX.GetPlayerFromId(_source)
    
    if not xPlayer then return end
    
    -- Vérification des permissions
    if not isAdmin(xPlayer) then
        TriggerClientEvent('esx:showNotification', _source, '~r~Vous n\'avez pas la permission.')
        return
    end
    
    loadStashesFromFile()

    -- Vérifier que l'ID n'existe pas déjà
    for _, s in ipairs(stashesCache) do
        if s.id == data.id then
            TriggerClientEvent('esx:showNotification', _source, '~r~Cet ID existe déjà.')
            return
        end
    end

    -- Créer le nouveau stash
    local ownerType = tostring(data.ownerType or 'everyone')
    local newStash = {
        id = tostring(data.id),
        label = tostring(data.label),
        slots = tonumber(data.slots) or 50,
        weight = tonumber(data.weight) or 100000,
        ownerType = ownerType,
        jobName = data.jobName,
        jobGrade = nil,
        crewId = data.crewId and tonumber(data.crewId) or nil,
        crewGradeRang = nil,
        coords = { x = data.coords.x, y = data.coords.y, z = data.coords.z },
        crewMembers = nil,
        personalMembers = sanitizePersonalMembers(data.personalMembers)
    }
    
    -- Si c'est un stash de métier, s'assurer que le grade est défini (0 par défaut)
    if ownerType == 'job' then
        newStash.jobGrade = tonumber(data.jobGrade) or 0
    elseif ownerType == 'crew' then
        -- Si c'est un stash de crew, stocker le grade requis (rang)
        if data.crewGradeRang then
            newStash.crewGradeRang = tonumber(data.crewGradeRang)
        end
    end

    -- Fonction pour finaliser la création
    local function finalizeCreation()
        if newStash.ownerType == 'crew' then
            newStash.crewMembers = newStash.crewMembers or {}
            newStash.personalMembers = nil
        elseif newStash.ownerType == 'personal' then
            newStash.personalMembers = sanitizePersonalMembers(newStash.personalMembers)
            newStash.crewMembers = nil
        else
            newStash.crewMembers = nil
            newStash.personalMembers = nil
        end
        
        table.insert(stashesCache, newStash)
        saveStashesToFile()
        clearOxInventory(newStash.id)
        registerStashWithOx(newStash)

        TriggerClientEvent('esx:showNotification', _source, '~g~Stash créé avec succès!')
        TriggerClientEvent('lfstashes:refreshStashes', _source)
        
        -- Rafraîchir les autres clients après un délai
        SetTimeout(500, function()
            refreshAllClients(_source)
        end)
    end

    -- Si c'est un stash crew, récupérer les membres
    if newStash.ownerType == 'crew' then
        local crewId = tonumber(newStash.crewId)
        if not crewId then
            TriggerClientEvent('esx:showNotification', _source, '~r~Aucun crew sélectionné.')
            return
        end
        newStash.crewId = crewId

        fetchCrewMembers(crewId, function(members)
            newStash.crewMembers = members
            finalizeCreation()
        end)
        return
    elseif newStash.ownerType == 'personal' then
        local personalMembers = sanitizePersonalMembers(data.personalMembers)
        if #personalMembers == 0 then
            TriggerClientEvent('esx:showNotification', _source, '~r~Veuillez ajouter au moins une personne.')
            return
        end
        newStash.personalMembers = personalMembers
        newStash.crewMembers = nil
    end

    finalizeCreation()
end)

--- Event pour ouvrir un stash
RegisterNetEvent('lfstashes:openStash', function(stashId)
    local _source = source
    local xPlayer = ESX.GetPlayerFromId(_source)
    
    if not xPlayer then return end
    
    -- Chercher le stash
    loadStashesFromFile()
    local stash = nil
    for _, s in ipairs(stashesCache) do
        if s.id == stashId then
            stash = s
            break
        end
    end
    if not stash then return end

    -- Vérifier l'accès
    local canAccess = false
    local playerIsAdmin = isAdmin(xPlayer)
    
    if stash.ownerType == 'everyone' then
        canAccess = true
    elseif stash.ownerType == 'job' then
        local minGrade = tonumber(stash.jobGrade or 0) or 0
        if xPlayer.job and xPlayer.job.name == stash.jobName and (xPlayer.job.grade or 0) >= minGrade then
            canAccess = true
        elseif playerIsAdmin then
            -- Les admins ont toujours accès aux stashes de métier
            canAccess = true
        end
    elseif stash.ownerType == 'crew' then
        if playerIsAdmin then
            -- Les admins ont toujours accès aux stashes de crew
            canAccess = true
        elseif stash.crewId then
            local crewId = tonumber(stash.crewId)
            if not crewId then
                TriggerClientEvent('esx:showNotification', _source, '~r~Crew invalide pour ce stash.')
                return
            end

            -- Récupérer le rang requis 
            -- Dans le système de crew : plus le rang est BAS, plus le grade est ÉLEVÉ
            -- Grade 1 (le plus haut) = rang 1 (le plus bas)
            -- Grade 2 = rang 2
            -- Grade 3 = rang 3
            -- Donc si requiredRang = 2 (grade 2), on veut grade 2 OU grade 1 (supérieur)
            -- Cela signifie playerRang <= requiredRang (rang 1 ou 2)
            local requiredRang = stash.crewGradeRang and tonumber(stash.crewGradeRang) or nil
            
            -- Vérifier le grade du joueur dans le crew
            fetchPlayerCrewGradeRang(xPlayer.identifier, crewId, function(playerRang)
                if not playerRang then
                    -- Le joueur n'est pas dans ce crew ou n'a pas de grade
                    TriggerClientEvent('esx:showNotification', _source, '~r~Vous n\'avez pas accès à ce stash.')
                    return
                end
                
                -- Vérifier si le grade est suffisant
                -- Si requiredRang est nil, tous les membres du crew ont accès
                local hasAccess = false
                if requiredRang then
                    -- Le joueur doit avoir un rang <= au rang requis
                    -- Par exemple, si requiredRang = 2 (grade 2 requis), le joueur doit avoir rang <= 2 (grade 2 ou 1)
                    -- Si playerRang = 3 (grade 3), alors 3 <= 2 = false, pas d'accès
                    -- Si playerRang = 2 (grade 2), alors 2 <= 2 = true, accès autorisé
                    -- Si playerRang = 1 (grade 1), alors 1 <= 2 = true, accès autorisé
                    hasAccess = (playerRang <= requiredRang)
                else
                    -- Pas de restriction de grade, vérifier juste l'appartenance au crew
                    -- Le joueur est dans le crew (playerRang n'est pas nil)
                    hasAccess = true
                end
                
                if hasAccess then
                    -- Déclencher la commande /me pour afficher "ouvre [stash name]"
                    local stashLabel = stash.label or stash.id
                    local text = ("L'individu ouvre %s"):format(stashLabel)
                    TriggerClientEvent('3dme:shareDisplay', -1, text, _source)
                    
                    TriggerClientEvent('lfstashes:openInventory', _source, stash.id)
                else
                    TriggerClientEvent('esx:showNotification', _source, '~r~Vous n\'avez pas le grade requis pour accéder à ce stash.')
                end
            end)
            return
        end
    elseif stash.ownerType == 'personal' then
        if playerIsAdmin then
            -- Les admins ont toujours accès aux stashes personnels
            canAccess = true
        else
            local identifier = trim(xPlayer.identifier or '')
            if identifier ~= '' then
                local members = stash.personalMembers or {}
                for _, member in ipairs(members) do
                    local memberIdentifier
                    if type(member) == 'table' then
                        memberIdentifier = member.identifier
                    elseif type(member) == 'string' then
                        memberIdentifier = member
                    end
                    if memberIdentifier then
                        memberIdentifier = trim(memberIdentifier)
                        if memberIdentifier ~= '' and memberIdentifier == identifier then
                            canAccess = true
                            break
                        end
                    end
                end
            end
        end
    end

    if canAccess then
        -- Déclencher la commande /me pour afficher "ouvre [stash name]"
        local stashLabel = stash.label or stash.id
        local text = ("L'individu ouvre %s"):format(stashLabel)
        TriggerClientEvent('3dme:shareDisplay', -1, text, _source)
        
        TriggerClientEvent('lfstashes:openInventory', _source, stash.id)
    else
        TriggerClientEvent('esx:showNotification', _source, '~r~Vous n\'avez pas accès à ce stash.')
    end
end)

--- Event pour ouvrir un stash à distance (admin)
RegisterNetEvent('lfstashes:adminOpenStash', function(stashId)
    local _source = source
    local xPlayer = ESX.GetPlayerFromId(_source)

    if not xPlayer then return end

    if not isAdmin(xPlayer) then
        TriggerClientEvent('esx:showNotification', _source, '~r~Vous n\'avez pas la permission.')
        return
    end

    if not stashId or stashId == '' then
        TriggerClientEvent('esx:showNotification', _source, '~r~ID de stash invalide.')
        return
    end

    loadStashesFromFile()

    local stash = nil
    for _, s in ipairs(stashesCache) do
        if s.id == stashId then
            stash = s
            break
        end
    end

    if not stash then
        TriggerClientEvent('esx:showNotification', _source, '~r~Stash introuvable.')
        return
    end

    registerStashWithOx(stash)
    
    -- Déclencher la commande /me pour afficher "ouvre [stash name]"
    local stashLabel = stash.label or stash.id
    local text = ("L'individu ouvre %s"):format(stashLabel)
    TriggerClientEvent('3dme:shareDisplay', -1, text, _source)
    
    TriggerClientEvent('lfstashes:openInventory', _source, stash.id)
    TriggerClientEvent('esx:showNotification', _source, '~g~Ouverture du stash.')
end)

--- Event pour supprimer un stash
RegisterNetEvent('lfstashes:deleteStash', function(stashId)
    local _source = source
    local xPlayer = ESX.GetPlayerFromId(_source)
    
    if not xPlayer then return end
    
    -- Vérification des permissions
    if not isAdmin(xPlayer) then
        TriggerClientEvent('esx:showNotification', _source, '~r~Vous n\'avez pas la permission.')
        return
    end
    
    loadStashesFromFile()
    
    -- Trouver et supprimer le stash
    local found = false
    for i, stash in ipairs(stashesCache) do
        if stash.id == stashId then
            table.remove(stashesCache, i)
            found = true
            break
        end
    end
    
    if found then
        saveStashesToFile()
        clearOxInventory(stashId)
        TriggerClientEvent('esx:showNotification', _source, '~g~Stash supprimé avec succès!')
        refreshAllClients()
    else
        TriggerClientEvent('esx:showNotification', _source, '~r~Stash introuvable.')
    end
end)

--- Event pour éditer un stash
RegisterNetEvent('lfstashes:editStash', function(data)
    local _source = source
    local xPlayer = ESX.GetPlayerFromId(_source)
    
    if not xPlayer then return end
    
    -- Vérification des permissions
    if not isAdmin(xPlayer) then
        TriggerClientEvent('esx:showNotification', _source, '~r~Vous n\'avez pas la permission.')
        return
    end
    
    loadStashesFromFile()
    
    -- Trouver le stash
    local stash = nil
    for _, s in ipairs(stashesCache) do
        if s.id == data.id then
            stash = s
            break
        end
    end
    
    if not stash then
        TriggerClientEvent('esx:showNotification', _source, '~r~Stash introuvable.')
        return
    end
    
    -- Mettre à jour les valeurs
    stash.label = data.label
    stash.slots = tonumber(data.slots) or 50
    stash.weight = tonumber(data.weight) or 100000
    stash.ownerType = data.ownerType
    stash.jobName = data.jobName
    stash.crewId = data.crewId and tonumber(data.crewId) or nil
    stash.personalMembers = nil
    
    -- Si c'est un stash de métier, s'assurer que le grade est défini (0 par défaut)
    if data.ownerType == 'job' then
        stash.jobGrade = tonumber(data.jobGrade) or 0
        stash.crewGradeRang = nil
    elseif data.ownerType == 'crew' then
        -- Si c'est un stash de crew, stocker le grade requis (rang)
        stash.jobGrade = nil
        if data.crewGradeRang then
            stash.crewGradeRang = tonumber(data.crewGradeRang)
        else
            stash.crewGradeRang = nil
        end
    else
        stash.jobGrade = nil
        stash.crewGradeRang = nil
    end
    
    if data.updateCoords and data.coords then
        stash.coords = { x = data.coords.x, y = data.coords.y, z = data.coords.z }
    end
    
    -- Fonction pour finaliser l'édition
    local function finalizeEdit()
        saveStashesToFile()
        registerStashWithOx(stash)
        TriggerClientEvent('esx:showNotification', _source, '~g~Stash modifié avec succès!')
        refreshAllClients()
    end
    
    -- Si c'est un crew, récupérer les membres
    if stash.ownerType == 'crew' then
        local crewId = tonumber(stash.crewId)
        if not crewId then
            TriggerClientEvent('esx:showNotification', _source, '~r~Aucun crew sélectionné.')
            return
        end
        stash.crewId = crewId
        
        fetchCrewMembers(crewId, function(members)
            stash.crewMembers = members
            finalizeEdit()
        end)
        return
    elseif stash.ownerType == 'personal' then
        local members = sanitizePersonalMembers(data.personalMembers)
        if #members == 0 then
            TriggerClientEvent('esx:showNotification', _source, '~r~Veuillez ajouter au moins une personne.')
            return
        end
        stash.personalMembers = members
        stash.crewMembers = nil
    else
        stash.crewMembers = nil
        stash.personalMembers = nil
    end
    
    finalizeEdit()
end)
