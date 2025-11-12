-- ================================================================
-- LfStashes - Client Script
-- Système de gestion des stashes pour ESX & ox_inventory
-- ================================================================

-- Variables globales
ESX = exports['es_extended']:getSharedObject()

-- Variables locales
local stashes = {}
local accessibleStashes = {}
local playerCrewId = nil
local isUIOpen = false

-- ================================================================
-- Fonctions utilitaires
-- ================================================================

--- Vérifie si le joueur peut accéder à un stash
---@param stash table
---@param playerData table
---@return boolean
local function CanAccessStash(stash, playerData)
    if stash.ownerType == 'everyone' then
        return true
    elseif stash.ownerType == 'job' then
        if playerData and playerData.job and playerData.job.name == stash.jobName then
            local grade = playerData.job.grade or 0
            if grade >= (stash.jobGrade or 0) then
                return true
            end
        end
    elseif stash.ownerType == 'crew' then
        if playerCrewId and stash.crewId and tonumber(stash.crewId) == tonumber(playerCrewId) then
            return true
        end
    elseif stash.ownerType == 'personal' then
        if playerData and playerData.identifier then
            local identifier = playerData.identifier
            local members = stash.personalMembers
            if members and type(members) == 'table' then
                for _, member in ipairs(members) do
                    local memberIdentifier = member
                    if type(member) == 'table' then
                        memberIdentifier = member.identifier
                    end
                    if memberIdentifier == identifier then
                        return true
                    end
                end
            end
        end
    end
    return false
end

--- Filtre les stashes accessibles par le joueur
local function UpdateAccessibleStashes()
    local playerData = ESX.GetPlayerData()
    accessibleStashes = {}
    
    for _, stash in ipairs(stashes) do
        if CanAccessStash(stash, playerData) then
            table.insert(accessibleStashes, stash)
        end
    end
end

--- Récupère l'ID du crew du joueur
local function RefreshPlayerCrewId()
    -- Si UseTerritory est désactivé, ne pas charger le crew
    if not Config.UseTerritory then
        playerCrewId = nil
        UpdateAccessibleStashes()
        return
    end
    
    local playerData = ESX.GetPlayerData()
    if not playerData or not playerData.identifier then
        -- ESX pas encore chargé, réessayer dans 1 seconde
        SetTimeout(1000, RefreshPlayerCrewId)
        return
    end
    
    ESX.TriggerServerCallback('lfTerritory:getPlayerCrewId', function(crewId)
        playerCrewId = crewId and tonumber(crewId) or nil
        UpdateAccessibleStashes()
    end)
end

--- Vérifie si le joueur est administrateur
---@return boolean
local function isAdmin()
    local playerData = ESX.GetPlayerData()
    if not playerData.group then return false end
    
    local group = playerData.group
    return group == Config.AdminGroup or group == 'superadmin' or group == '_dev'
end

-- ================================================================
-- Events réseau
-- ================================================================

--- Event pour rafraîchir les stashes
RegisterNetEvent('lfstashes:refreshStashes', function()
    ESX.TriggerServerCallback('lfstashes:getStashes', function(result)
        stashes = result
        UpdateAccessibleStashes()
    end)
end)

--- Event pour ouvrir l'inventaire d'un stash
RegisterNetEvent('lfstashes:openInventory', function(stashId)
    exports.ox_inventory:openInventory('stash', stashId)
end)

--- Event pour mettre à jour quand le job change
RegisterNetEvent('esx:setJob', function()
    UpdateAccessibleStashes()
end)

--- Event pour mettre à jour quand le joueur se connecte
RegisterNetEvent('esx:playerLoaded', function()
    RefreshPlayerCrewId()
end)

-- ================================================================
-- Commandes
-- ================================================================

--- Commande pour créer un stash
RegisterCommand(Config.Command, function()
    if not isAdmin() then
        ESX.ShowNotification('~r~Vous n\'avez pas la permission.')
        return
    end
    
    SetNuiFocus(true, true)
    SendNUIMessage({ type = 'openUI' })
    isUIOpen = true
end, false)

--- Commande pour gérer les stashes
RegisterCommand(Config.ManageCommand, function()
    if not isAdmin() then
        ESX.ShowNotification('~r~Vous n\'avez pas la permission.')
        return
    end

    SetNuiFocus(true, true)
    ESX.TriggerServerCallback('lfstashes:getStashes', function(result)
        SendNUIMessage({
            type = 'openManageUI',
            stashes = result
        })
        isUIOpen = true
    end)
end, false)

-- ================================================================
-- Callbacks NUI
-- ================================================================

--- Callback pour fermer l'UI
RegisterNUICallback('closeUI', function(data, cb)
    SetNuiFocus(false, false)
    isUIOpen = false
    cb('ok')
end)

--- Callback pour fermer l'UI de gestion
RegisterNUICallback('closeManageUI', function(data, cb)
    SetNuiFocus(false, false)
    isUIOpen = false
    cb('ok')
end)

--- Callback pour obtenir la liste des métiers
RegisterNUICallback('getJobs', function(data, cb)
    ESX.TriggerServerCallback('lfstashes:getJobsList', function(jobs)
        cb(jobs)
    end)
end)

--- Callback pour obtenir les grades d'un métier
RegisterNUICallback('getJobGrades', function(data, cb)
    ESX.TriggerServerCallback('lfstashes:getJobGrades', function(grades)
        cb(grades)
    end, data.jobName)
end)

--- Callback pour obtenir la liste des crews
RegisterNUICallback('getCrews', function(data, cb)
    ESX.TriggerServerCallback('lfstashes:getCrewsList', function(crews)
        cb(crews)
    end)
end)

--- Callback pour obtenir la config UseTerritory
RegisterNUICallback('getConfig', function(data, cb)
    cb({ useTerritory = Config.UseTerritory })
end)

--- Callback pour créer un stash
RegisterNUICallback('createStash', function(data, cb)
    local playerPed = PlayerPedId()
    local coords = GetEntityCoords(playerPed)
    
    data.coords = {
        x = coords.x,
        y = coords.y,
        z = coords.z
    }
    
    TriggerServerEvent('lfstashes:createStash', data)
    
    SetNuiFocus(false, false)
    isUIOpen = false
    
    cb('ok')
end)

--- Callback pour supprimer un stash
RegisterNUICallback('deleteStash', function(data, cb)
    TriggerServerEvent('lfstashes:deleteStash', data.id)
    cb('ok')
end)

--- Callback pour rechercher des joueurs (stashes personnels)
RegisterNUICallback('searchPlayers', function(data, cb)
    local query = data and data.query or ''
    if type(query) ~= 'string' or #query < 3 then
        cb({})
        return
    end

    ESX.TriggerServerCallback('lfstashes:searchPlayers', function(results)
        cb(results or {})
    end, query)
end)

--- Callback pour visualiser un stash à distance
RegisterNUICallback('viewStash', function(data, cb)
    SetNuiFocus(false, false)
    isUIOpen = false
    TriggerServerEvent('lfstashes:adminOpenStash', data.id)
    cb('ok')
end)

--- Callback pour éditer un stash
RegisterNUICallback('editStash', function(data, cb)
    if data.updateCoords then
        local playerPed = PlayerPedId()
        local coords = GetEntityCoords(playerPed)
        data.coords = {
            x = coords.x,
            y = coords.y,
            z = coords.z
        }
    end
    
    TriggerServerEvent('lfstashes:editStash', data)
    cb('ok')
end)

--- Callback pour rafraîchir la liste de gestion
RegisterNUICallback('refreshManageUI', function(data, cb)
    ESX.TriggerServerCallback('lfstashes:getStashes', function(result)
        stashes = result
        UpdateAccessibleStashes()
        
        SendNUIMessage({
            type = 'openManageUI',
            stashes = result
        })
    end)
    cb('ok')
end)

-- ================================================================
-- Threads
-- ================================================================

--- Thread pour charger les stashes au démarrage
CreateThread(function()
    ESX.TriggerServerCallback('lfstashes:getStashes', function(result)
        stashes = result
        RefreshPlayerCrewId()
    end)
end)

--- Thread pour rafraîchir le crew périodiquement
CreateThread(function()
    while true do
        Wait(120000) -- 2 minutes
        if ESX.GetPlayerData().identifier then
            RefreshPlayerCrewId()
        end
    end
end)

--- Thread pour afficher les markers et gérer l'interaction (optimisé)
CreateThread(function()
    while true do
        local wait = 1200
        local playerPed = PlayerPedId()
        local playerCoords = GetEntityCoords(playerPed)
        local stashCount = #accessibleStashes
        
        if stashCount > 0 then
            local px, py, pz = playerCoords.x, playerCoords.y, playerCoords.z
            local nearestDistance = 9999.0
            local showingMarker = false
            
            for i = 1, stashCount do
                local stash = accessibleStashes[i]
                local sx, sy, sz = stash.coords.x, stash.coords.y, stash.coords.z
                
                -- Calcul de distance au carré (optimisé)
                local dx, dy, dz = px - sx, py - sy, pz - sz
                local distSqr = dx * dx + dy * dy + dz * dz
                
                if distSqr < 400.0 then -- < 20m
                    local dist = math.sqrt(distSqr)
                    
                    if dist < nearestDistance then
                        nearestDistance = dist
                    end
                    
                    if dist < 8.0 then
                        wait = 2
                        showingMarker = true
                        
                        -- Dessiner le marker
                        DrawMarker(
                            25, sx, sy, sz - 0.98,
                            0.0, 0.0, 0.0,
                            0.0, 0.0, 0.0,
                            0.3, 0.3, 0.3,
                            9, 150, 78, 200,
                            false, true, 2, false, nil, nil, false
                        )
                        
                        if dist < 1.5 then
                            ESX.ShowHelpNotification('Appuyez sur ~INPUT_CONTEXT~ pour ouvrir ~g~' .. stash.label)
                            
                            if IsControlJustPressed(0, 38) then
                                TriggerServerEvent('lfstashes:openStash', stash.id)
                            end
                        end
                    end
                end
            end
            
            if not showingMarker then
                wait = nearestDistance < 20.0 and 500 or 1200
            end
        end
        
        Wait(wait)
    end
end)
