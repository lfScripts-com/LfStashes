// Variables globales
let jobs = [];
let crews = [];
let currentJobGrades = [];
let currentCrewGrades = [];
let manageStashes = [];
let filteredStashes = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 5;
const resourceName = typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'lfstashes';
let useTerritory = true; // Sera mis à jour par le callback
let personalSelectorCreate = null;
let personalSelectorEdit = null;

function initPersonalSelector(config) {
    const inputEl = document.getElementById(config.inputId);
    const resultsWrapper = document.getElementById(config.resultsId);
    const listEl = document.getElementById(config.listId);
    const chipsWrapper = document.getElementById(config.chipsId);
    const containerEl = document.getElementById(config.containerId);
    const rootEl = document.getElementById(config.rootId);

    if (!inputEl || !resultsWrapper || !listEl || !chipsWrapper || !containerEl || !rootEl) {
        console.warn('[LfStashes] Impossible d\'initialiser le sélecteur personnel pour', config);
        return null;
    }

    const state = {
        selected: [],
        debounce: null,
        lastQuery: '',
        outsideHandler: null
    };

    function hideResults() {
        resultsWrapper.classList.add('hidden');
        resultsWrapper.setAttribute('aria-expanded', 'false');
        listEl.innerHTML = '';
    }

    function renderSelected() {
        chipsWrapper.innerHTML = '';

        if (!state.selected.length) {
            containerEl.classList.add('hidden');
            return;
        }

        containerEl.classList.remove('hidden');

        state.selected.forEach(member => {
            const chip = document.createElement('div');
            chip.className = 'selected-chip';

            const label = document.createElement('span');
            label.textContent = member.displayName || member.identifier;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.innerHTML = '&times;';
            removeBtn.onclick = () => removePlayer(member.identifier);

            chip.appendChild(label);
            chip.appendChild(removeBtn);
            chipsWrapper.appendChild(chip);
        });
    }

    function removePlayer(identifier) {
        state.selected = state.selected.filter(item => item.identifier !== identifier);
        renderSelected();
    }

    function addPlayer(player) {
        const identifier = (player.identifier || '').trim();
        if (!identifier) {
            return;
        }

        if (state.selected.some(item => item.identifier === identifier)) {
            hideResults();
            inputEl.value = '';
            return;
        }

        const displayName = (player.displayName || player.name || '').trim();
        state.selected.push({
            identifier: identifier,
            displayName: displayName
        });

        renderSelected();
        hideResults();
        inputEl.value = '';
    }

    function renderResults(players) {
        const available = Array.isArray(players)
            ? players.filter(player => {
                if (!player) return false;
                const identifier = (player.identifier || '').trim();
                if (!identifier) return false;
                return !state.selected.some(item => item.identifier === identifier);
            })
            : [];

        listEl.innerHTML = '';

        if (!available.length) {
            const li = document.createElement('li');
            const empty = document.createElement('div');
            empty.className = 'no-results';
            empty.textContent = 'Aucun joueur trouvé.';
            li.appendChild(empty);
            listEl.appendChild(li);
            resultsWrapper.classList.remove('hidden');
            resultsWrapper.setAttribute('aria-expanded', 'true');
            return;
        }

        available.forEach(player => {
            const identifier = (player.identifier || '').trim();
            const displayName = (player.displayName || player.name || '').trim();

            const li = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = displayName || identifier;

            const idSpan = document.createElement('span');
            idSpan.className = 'player-identifier';
            idSpan.textContent = identifier;

            button.appendChild(nameSpan);
            button.appendChild(idSpan);

            button.onclick = () => {
                addPlayer({ identifier, displayName });
                inputEl.focus();
            };

            li.appendChild(button);
            listEl.appendChild(li);
        });

        resultsWrapper.classList.remove('hidden');
        resultsWrapper.setAttribute('aria-expanded', 'true');
    }

    async function searchPlayers(query) {
        state.lastQuery = query;
        const response = await post('searchPlayers', { query });
        if (!response) {
            hideResults();
            return;
        }

        try {
            const data = await response.json();
            if (state.lastQuery !== query) {
                return;
            }
            renderResults(data);
        } catch (error) {
            console.error('Erreur lors du parsing des joueurs personnels:', error);
            hideResults();
        }
    }

    inputEl.addEventListener('input', (event) => {
        const value = event.target.value.trim();
        if (state.debounce) {
            clearTimeout(state.debounce);
        }

        if (value.length < 3) {
            hideResults();
            return;
        }

        state.debounce = setTimeout(() => {
            searchPlayers(value);
        }, 250);
    });

    inputEl.addEventListener('focus', () => {
        if (inputEl.value.trim().length >= 3 && listEl.children.length > 0) {
            resultsWrapper.classList.remove('hidden');
            resultsWrapper.setAttribute('aria-expanded', 'true');
        }
    });

    inputEl.addEventListener('blur', () => {
        setTimeout(() => hideResults(), 180);
    });

    state.outsideHandler = (event) => {
        if (!rootEl.contains(event.target)) {
            hideResults();
        }
    };
    document.addEventListener('click', state.outsideHandler);

    state.getSelected = () => state.selected.map(item => ({
        identifier: item.identifier,
        displayName: item.displayName
    }));

    state.setSelected = (items) => {
        if (!Array.isArray(items)) {
            state.selected = [];
        } else {
            state.selected = items
                .filter(entry => entry && entry.identifier)
                .map(entry => ({
                    identifier: String(entry.identifier),
                    displayName: entry.displayName ? String(entry.displayName) : ''
                }));
        }
        renderSelected();
    };

    state.reset = () => {
        state.selected = [];
        inputEl.value = '';
        hideResults();
        renderSelected();
    };

    state.hideResults = hideResults;

    state.destroy = () => {
        if (state.debounce) {
            clearTimeout(state.debounce);
            state.debounce = null;
        }
        hideResults();
        if (state.outsideHandler) {
            document.removeEventListener('click', state.outsideHandler);
            state.outsideHandler = null;
        }
    };

    renderSelected();

    return state;
}


// Fonction pour envoyer une requête POST au client
async function post(url, data = {}) {
    try {
        const response = await fetch(`https://${resourceName}/${url}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        return response;
    } catch (error) {
        console.error('Erreur lors de la communication NUI:', error);
        return null;
    }
}

// Fonction pour ouvrir l'UI
function openUI() {
    document.getElementById('stashContainer').classList.remove('hidden');
    document.getElementById('manageContainer').classList.add('hidden');
    
    // Charger les métiers
    loadJobs();
    
    // Charger les crews uniquement si UseTerritory est activé
    if (useTerritory) {
        loadCrews();
    } else {
        // Masquer l'option "Crew" du select
        const ownerTypeSelect = document.getElementById('ownerType');
        const crewOption = ownerTypeSelect.querySelector('option[value="crew"]');
        if (crewOption) {
            crewOption.remove();
        }
    }

    const personalOptions = document.getElementById('personalOptions');
    if (personalOptions) {
        personalOptions.classList.add('hidden');
    }

    if (personalSelectorCreate) {
        personalSelectorCreate.reset();
    }
}

// Fonction pour fermer l'UI
function closeUI() {
    document.getElementById('stashContainer').classList.add('hidden');
    
    // Réinitialiser le formulaire
    document.getElementById('stashForm').reset();
    document.getElementById('jobOptions').classList.add('hidden');
    document.getElementById('crewOptions').classList.add('hidden');
    document.getElementById('personalOptions').classList.add('hidden');
    
    // Réinitialiser les selects de grades
    const jobGradeSelect = document.getElementById('jobGrade');
    if (jobGradeSelect) {
        jobGradeSelect.innerHTML = '<option value="">Sélectionner d\'abord un métier</option>';
    }
    
    const crewGradeSelect = document.getElementById('crewGrade');
    if (crewGradeSelect) {
        crewGradeSelect.innerHTML = '<option value="">Sélectionner d\'abord un crew</option>';
    }

    if (personalSelectorCreate) {
        personalSelectorCreate.reset();
    }
    
    post('closeUI', {});
}

function openManageUI(stashes) {
    manageStashes = Array.isArray(stashes) ? stashes : [];
    filteredStashes = [...manageStashes];
    currentPage = 1;
    document.getElementById('stashContainer').classList.add('hidden');
    document.getElementById('manageContainer').classList.remove('hidden');
    document.getElementById('stashSearch').value = '';
    renderManageList();
}

function closeManageUI() {
    document.getElementById('manageContainer').classList.add('hidden');
    post('closeManageUI', {});
}

function formatNumber(value) {
    return value ? value.toLocaleString('fr-FR') : '0';
}

function formatType(stash) {
    if (stash.ownerType === 'job') {
        const grade = stash.jobGrade && stash.jobGrade > 0 ? ` | Grade ≥ ${stash.jobGrade}` : '';
        return `Métier • ${stash.jobName || 'Inconnu'}${grade}`;
    } else if (stash.ownerType === 'crew') {
        return `Crew • ID ${stash.crewId || '?'}`;
    } else if (stash.ownerType === 'personal') {
        const members = Array.isArray(stash.personalMembers) ? stash.personalMembers : [];
        if (members.length > 0) {
            const labels = members.map(member => member.displayName || member.identifier || 'Inconnu');
            const preview = labels.slice(0, 2).join(', ');
            if (labels.length > 2) {
                return `Personnel • ${preview} +${labels.length - 2}`;
            }
            return `Personnel • ${preview}`;
        }
        return 'Personnel';
    }
    return 'Ouvert à tous';
}

function formatCoord(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toFixed(1);
    }
    const num = Number(value);
    if (Number.isFinite(num)) {
        return num.toFixed(1);
    }
    return '0.0';
}

function getTypeClass(ownerType) {
    if (ownerType === 'job') return 'type-job';
    if (ownerType === 'crew') return 'type-crew';
    if (ownerType === 'personal') return 'type-personal';
    return 'type-everyone';
}

function renderManageList() {
    const listEl = document.getElementById('stashList');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    listEl.innerHTML = '';

        if (filteredStashes.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'stash-empty';
            empty.textContent = 'Aucun stash trouvé.';
            listEl.appendChild(empty);
        paginationInfo.textContent = 'Page 1 / 1';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    const totalPages = Math.max(1, Math.ceil(filteredStashes.length / ITEMS_PER_PAGE));
    currentPage = Math.min(currentPage, totalPages);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredStashes.length);

    for (let i = startIndex; i < endIndex; i++) {
        const stash = filteredStashes[i];
        const card = document.createElement('div');
        card.className = `stash-card ${getTypeClass(stash.ownerType)}`;

        // Boutons d'action
        const actions = document.createElement('div');
        actions.className = 'stash-actions';
        
        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn-action btn-view';
        viewBtn.innerHTML = '<span class="material-icons">visibility</span>';
        viewBtn.onclick = () => viewStash(stash);
        
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-action btn-edit';
        editBtn.innerHTML = '<span class="material-icons">edit</span>';
        editBtn.onclick = () => openEditModal(stash);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-action btn-delete';
        deleteBtn.innerHTML = '<span class="material-icons">delete</span>';
        deleteBtn.onclick = () => openDeleteConfirm(stash);
        
        actions.appendChild(viewBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        const topRow = document.createElement('div');
        topRow.className = 'top-row';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = stash.label || '-';

        const meta = document.createElement('span');
        meta.className = 'meta';
        const slotsText = `${stash.slots || 0} slots`;
        const weightText = `${formatNumber(stash.weight || 0)} poids`;
        meta.textContent = `ID ${stash.id} • ${slotsText} • ${weightText}`;

        topRow.appendChild(label);
        topRow.appendChild(meta);

        const bottomRow = document.createElement('div');
        bottomRow.className = 'bottom-row';
        const coords = stash.coords || { x: 0, y: 0, z: 0 };
        const coordsSpan = document.createElement('span');
        coordsSpan.className = 'coords';
        coordsSpan.textContent = `Coords : (${formatCoord(coords.x)}, ${formatCoord(coords.y)}, ${formatCoord(coords.z)})`;

        const typeSpan = document.createElement('span');
        typeSpan.className = 'type-info';
        typeSpan.textContent = formatType(stash);

        bottomRow.appendChild(coordsSpan);
        bottomRow.appendChild(typeSpan);

        card.appendChild(actions);
        card.appendChild(topRow);
        card.appendChild(bottomRow);
        listEl.appendChild(card);
    }

    paginationInfo.textContent = `Page ${currentPage} / ${totalPages}`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
}

function viewStash(stash) {
    if (!stash || !stash.id) return;
    closeManageUI();
    setTimeout(() => {
        post('viewStash', { id: stash.id });
    }, 120);
}

function applySearchFilter(query) {
    const lowerQuery = (query || '').toLowerCase();
    filteredStashes = manageStashes.filter((stash) => {
        if (!lowerQuery) return true;
        const fields = [
            stash.id || '',
            stash.label || '',
            stash.ownerType || '',
            stash.jobName || '',
            stash.crewId ? String(stash.crewId) : ''
        ];
        if (Array.isArray(stash.personalMembers)) {
            stash.personalMembers.forEach(member => {
                if (!member) return;
                if (member.displayName) fields.push(member.displayName);
                if (member.identifier) fields.push(member.identifier);
            });
        }
        return fields.some(field => field.toLowerCase().includes(lowerQuery));
    });
    currentPage = 1;
    renderManageList();
}

// Fonction pour charger les métiers
async function loadJobs() {
    const response = await post('getJobs', {});
    if (!response) {
        console.warn('Impossible de récupérer la liste des métiers.');
        return;
    }
    const data = await response.json();
    
    jobs = data;
    
    const jobSelect = document.getElementById('jobName');
    jobSelect.innerHTML = '<option value="">Sélectionner un métier</option>';
    
    data.forEach(job => {
        const option = document.createElement('option');
        option.value = job.name;
        option.textContent = job.label;
        jobSelect.appendChild(option);
    });
}

// Fonction pour charger les grades d'un métier
async function loadJobGrades(jobName) {
    const response = await post('getJobGrades', { jobName: jobName });
    if (!response) {
        console.warn('Impossible de récupérer les grades pour le métier:', jobName);
        return;
    }
    const data = await response.json();
    
    currentJobGrades = data;
    
    const gradeSelect = document.getElementById('jobGrade');
    gradeSelect.innerHTML = '';
    
    // Sélectionner automatiquement le grade 0 (le plus bas)
    let defaultSelected = false;
    data.forEach(grade => {
        const option = document.createElement('option');
        option.value = grade.grade;
        option.textContent = `${grade.label} (Grade ${grade.grade})`;
        // Sélectionner le grade 0 par défaut
        if (grade.grade === 0 && !defaultSelected) {
            option.selected = true;
            defaultSelected = true;
        }
        gradeSelect.appendChild(option);
    });
}

// Fonction pour charger les crews
async function loadCrews() {
    const response = await post('getCrews', {});
    if (!response) {
        console.warn('Impossible de récupérer la liste des crews.');
        return;
    }
    const data = await response.json();
    
    crews = data;
    
    const crewSelect = document.getElementById('crewName');
    crewSelect.innerHTML = '<option value="">Sélectionner un crew</option>';
    
    data.forEach(crew => {
        const option = document.createElement('option');
        option.value = crew.id_crew;
        option.textContent = crew.name;
        crewSelect.appendChild(option);
    });
}

// Fonction pour charger les grades d'un crew
async function loadCrewGrades(crewId) {
    const response = await post('getCrewGrades', { crewId: crewId });
    if (!response) {
        console.warn('Impossible de récupérer les grades pour le crew:', crewId);
        return null;
    }
    const data = await response.json();
    
    currentCrewGrades = data;
    
    const gradeSelect = document.getElementById('crewGrade');
    if (!gradeSelect) return null;
    
    gradeSelect.innerHTML = '';
    
    // Trouver le grade avec le rang le plus élevé (grade le plus bas) pour sélection par défaut
    let defaultRang = null;
    if (data && data.length > 0) {
        // Les grades sont déjà triés par rang DESC (rang le plus élevé en premier)
        defaultRang = data[0].rang;
        
        data.forEach(grade => {
            const option = document.createElement('option');
            option.value = grade.rang;
            option.textContent = `${grade.name} (Rang ${grade.rang})`;
            // Sélectionner le grade le plus bas par défaut (rang le plus élevé)
            if (grade.rang === defaultRang) {
                option.selected = true;
            }
            gradeSelect.appendChild(option);
        });
    }
    
    return defaultRang;
}

// Fonction pour créer un stash
function createStash() {
    const id = document.getElementById('stashId').value.trim();
    const label = document.getElementById('stashLabel').value.trim();
    const slots = parseInt(document.getElementById('stashSlots').value) || 50;
    const weight = parseInt(document.getElementById('stashWeight').value) || 100000;
    const ownerType = document.getElementById('ownerType').value;
    
    // Validation
    if (!id) {
        alert('Veuillez saisir un ID');
        return;
    }
    
    if (!label) {
        alert('Veuillez saisir un nom');
        return;
    }
    
    if (!ownerType) {
        alert('Veuillez sélectionner un type de propriétaire');
        return;
    }
    
    // Préparer les données selon le type de propriétaire
    const data = {
        id: id,
        label: label,
        slots: slots,
        weight: weight,
        ownerType: ownerType
    };
    
    if (ownerType === 'job') {
        const jobName = document.getElementById('jobName').value;
        const jobGradeSelect = document.getElementById('jobGrade');
        const jobGrade = jobGradeSelect.value !== '' ? parseInt(jobGradeSelect.value) : 0;
        
        if (!jobName) {
            alert('Veuillez sélectionner un métier');
            return;
        }
        
        // Le grade 0 est sélectionné par défaut, donc on l'utilise même si non explicitement sélectionné
        data.jobName = jobName;
        data.jobGrade = isNaN(jobGrade) ? 0 : jobGrade;
    } else if (ownerType === 'crew') {
        const crewIdValue = document.getElementById('crewName').value;
        const crewId = parseInt(crewIdValue, 10);
        
        if (!crewIdValue || Number.isNaN(crewId)) {
            alert('Veuillez sélectionner un crew');
            return;
        }
        
        data.crewId = crewId;
        
        // Récupérer le grade sélectionné ou utiliser le grade par défaut
        const crewGradeSelect = document.getElementById('crewGrade');
        const selectedRang = crewGradeSelect.value !== '' ? parseInt(crewGradeSelect.value, 10) : null;
        
        if (selectedRang !== null && !isNaN(selectedRang)) {
            data.crewGradeRang = selectedRang;
        } else {
            // Utiliser le rang par défaut (grade le plus bas) si aucun grade n'est sélectionné
            const defaultRang = document.getElementById('crewName').dataset.defaultRang;
            if (defaultRang) {
                data.crewGradeRang = parseInt(defaultRang, 10);
            }
        }
    } else if (ownerType === 'personal') {
        const selected = personalSelectorCreate ? personalSelectorCreate.getSelected() : [];
        if (!selected.length) {
            alert('Veuillez ajouter au moins une personne.');
            return;
        }
        data.personalMembers = selected;
    }
    
    // Envoyer au client
    post('createStash', data);
    
    // Fermer l'UI
    closeUI();
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Cacher l'UI au démarrage
    document.getElementById('stashContainer').classList.add('hidden');
    document.getElementById('manageContainer').classList.add('hidden');
    
    // Bouton Créer
    document.getElementById('stashForm').addEventListener('submit', function(e) {
        e.preventDefault();
        createStash();
    });
    
    personalSelectorCreate = initPersonalSelector({
        inputId: 'personalSearch',
        resultsId: 'personalResults',
        listId: 'personalResultsList',
        chipsId: 'personalChips',
        containerId: 'personalSelected',
        rootId: 'personalOptions'
    });
    
    // Bouton Annuler
    document.getElementById('cancelBtn').addEventListener('click', closeUI);

    // Gestion UI de management
    document.getElementById('closeManageBtn').addEventListener('click', closeManageUI);
    document.getElementById('stashSearch').addEventListener('input', function(e) {
        applySearchFilter(e.target.value);
    });
    document.getElementById('prevPageBtn').addEventListener('click', function() {
        if (currentPage > 1) {
            currentPage -= 1;
            renderManageList();
        }
    });
    document.getElementById('nextPageBtn').addEventListener('click', function() {
        const totalPages = Math.max(1, Math.ceil(filteredStashes.length / ITEMS_PER_PAGE));
        if (currentPage < totalPages) {
            currentPage += 1;
            renderManageList();
        }
    });
    
    // Changement du type de propriétaire
    document.getElementById('ownerType').addEventListener('change', function(e) {
        const value = e.target.value;
        
        // Cacher toutes les options
        document.getElementById('jobOptions').classList.add('hidden');
        document.getElementById('crewOptions').classList.add('hidden');
        document.getElementById('personalOptions').classList.add('hidden');
        
        // Afficher les options appropriées
        if (value === 'job') {
            document.getElementById('jobOptions').classList.remove('hidden');
        } else if (value === 'crew') {
            document.getElementById('crewOptions').classList.remove('hidden');
        } else if (value === 'personal') {
            document.getElementById('personalOptions').classList.remove('hidden');
            if (personalSelectorCreate) {
                personalSelectorCreate.hideResults();
            }
        }
    });
    
    // Changement du métier
    document.getElementById('jobName').addEventListener('change', function(e) {
        const jobName = e.target.value;
        
        if (jobName) {
            loadJobGrades(jobName);
        } else {
            document.getElementById('jobGrade').innerHTML = '<option value="">Sélectionner d\'abord un métier</option>';
        }
    });
    
    // Changement du crew
    document.getElementById('crewName').addEventListener('change', async function(e) {
        const crewId = e.target.value;
        
        if (crewId) {
            // Charger les grades et remplir le select
            const defaultRang = await loadCrewGrades(crewId);
            // Stocker le rang par défaut pour utilisation si aucun grade n'est sélectionné
            document.getElementById('crewName').dataset.defaultRang = defaultRang || '';
        } else {
            // Réinitialiser le select des grades
            const gradeSelect = document.getElementById('crewGrade');
            if (gradeSelect) {
                gradeSelect.innerHTML = '<option value="">Sélectionner d\'abord un crew</option>';
            }
        }
    });
    
    // Validation en temps réel pour les nombres
    document.getElementById('stashSlots').addEventListener('input', function(e) {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
    
    document.getElementById('stashWeight').addEventListener('input', function(e) {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
    
    // Fermer l'UI avec la touche Echap
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const stashVisible = !document.getElementById('stashContainer').classList.contains('hidden');
            const manageVisible = !document.getElementById('manageContainer').classList.contains('hidden');
            if (stashVisible) {
                closeUI();
            } else if (manageVisible) {
                closeManageUI();
            }
        }
    });
});

// Fonctions pour la suppression
function openDeleteConfirm(stash) {
    const modal = document.createElement('div');
    modal.className = 'confirm-modal';
    modal.innerHTML = `
        <div class="confirm-content">
            <h3>Confirmer la suppression</h3>
            <p>Êtes-vous sûr de vouloir supprimer le stash <strong>"${stash.label}"</strong> ?<br><br>Cette action est irréversible.</p>
            <div class="confirm-buttons">
                <button class="btn btn-danger" id="confirmDeleteBtn">Supprimer</button>
                <button class="btn btn-success" id="cancelDeleteBtn">Annuler</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById('confirmDeleteBtn').onclick = () => {
        post('deleteStash', { id: stash.id });
        document.body.removeChild(modal);
        // Fermer la gestion et rouvrir pour rafraîchir
        setTimeout(() => {
            post('refreshManageUI', {});
        }, 200);
    };
    
    document.getElementById('cancelDeleteBtn').onclick = () => {
        document.body.removeChild(modal);
    };
}

// Fonctions pour l'édition
let currentEditStash = null;

function openEditModal(stash) {
    currentEditStash = stash;
    
    const modal = document.createElement('div');
    modal.className = 'edit-modal';
    modal.id = 'editModal';
    
    // Construire les options en fonction de UseTerritory
    let ownerTypeOptions = `
        <option value="job" ${stash.ownerType === 'job' ? 'selected' : ''}>Métier</option>
    `;
    
    if (useTerritory) {
        ownerTypeOptions += `<option value="crew" ${stash.ownerType === 'crew' ? 'selected' : ''}>Crew</option>`;
    }
    
    ownerTypeOptions += `
        <option value="personal" ${stash.ownerType === 'personal' ? 'selected' : ''}>Personnel</option>
        <option value="everyone" ${stash.ownerType === 'everyone' ? 'selected' : ''}>Tout le monde</option>
    `;
    
    const jobOptionsHtml = stash.ownerType === 'job' ? '' : 'hidden';
    const crewOptionsHtml = (stash.ownerType === 'crew' && useTerritory) ? '' : 'hidden';
    const personalOptionsHtml = stash.ownerType === 'personal' ? '' : 'hidden';
    
    modal.innerHTML = `
        <div class="edit-content">
            <h3>Éditer le stash</h3>
            <div class="edit-form">
                <div class="form-group">
                    <label for="editLabel">Nom: <span class="required">*</span></label>
                    <input type="text" id="editLabel" class="form-input" value="${stash.label}" required>
                </div>
                
                <div class="form-group">
                    <label for="editSlots">Slots:</label>
                    <input type="number" id="editSlots" class="form-input" value="${stash.slots || 50}" min="1" max="200">
                </div>
                
                <div class="form-group">
                    <label for="editWeight">Poids:</label>
                    <input type="number" id="editWeight" class="form-input" value="${stash.weight || 100000}" min="1000">
                </div>
                
                <div class="form-group">
                    <label for="editOwnerType">Propriétaire:</label>
                    <select id="editOwnerType" class="form-select">
                        ${ownerTypeOptions}
                    </select>
                </div>
                
                <div id="editJobOptions" class="conditional-options ${jobOptionsHtml}">
                    <div class="form-group">
                        <label for="editJobName">Nom du métier:</label>
                        <select id="editJobName" class="form-select">
                            <option value="">Chargement...</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="editJobGrade">Grade requis:</label>
                        <select id="editJobGrade" class="form-select">
                            <option value="">Sélectionner d'abord un métier</option>
                        </select>
                    </div>
                </div>
                
                <div id="editCrewOptions" class="conditional-options ${crewOptionsHtml}">
                    <div class="form-group">
                        <label for="editCrewName">Nom du crew:</label>
                        <select id="editCrewName" class="form-select">
                            <option value="">Chargement...</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="editCrewGrade">Grade requis:</label>
                        <select id="editCrewGrade" class="form-select">
                            <option value="">Sélectionner d'abord un crew</option>
                        </select>
                    </div>
                </div>
                
                <div id="editPersonalOptions" class="conditional-options ${personalOptionsHtml}">
                    <div class="form-group">
                        <label for="editPersonalSearch">Autorisations personnelles:</label>
                        <input type="text" id="editPersonalSearch" class="form-input" placeholder="Rechercher (nom, prénom ou identifiant)" maxlength="60">
                        <small class="hint">Saisir au moins 3 caractères pour afficher des résultats.</small>
                    </div>
                    <div id="editPersonalResults" class="personal-results hidden" role="listbox" aria-expanded="false">
                        <ul id="editPersonalResultsList"></ul>
                    </div>
                    <div id="editPersonalSelected" class="personal-selected hidden">
                        <p class="selected-title">Joueurs autorisés :</p>
                        <div id="editPersonalChips" class="selected-chips"></div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" id="updateCoords" style="width: auto;">
                        <span>Mettre à jour les coordonnées (position actuelle)</span>
                    </label>
                </div>
            </div>
            
            <div class="edit-buttons">
                <button class="btn btn-success" id="saveEditBtn">Enregistrer</button>
                <button class="btn btn-danger" id="cancelEditBtn">Annuler</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    personalSelectorEdit = initPersonalSelector({
        inputId: 'editPersonalSearch',
        resultsId: 'editPersonalResults',
        listId: 'editPersonalResultsList',
        chipsId: 'editPersonalChips',
        containerId: 'editPersonalSelected',
        rootId: 'editPersonalOptions'
    });
    
    if (personalSelectorEdit) {
        personalSelectorEdit.setSelected(Array.isArray(stash.personalMembers) ? stash.personalMembers : []);
    }
    
    // Charger les listes
    loadEditJobsList(stash.jobName);
    loadEditCrewsList(stash.crewId);
    
    // Event listeners
    const ownerTypeSelect = document.getElementById('editOwnerType');
    const toggleEditOptions = (val) => {
        document.getElementById('editJobOptions').classList.toggle('hidden', val !== 'job');
        document.getElementById('editCrewOptions').classList.toggle('hidden', val !== 'crew');
        document.getElementById('editPersonalOptions').classList.toggle('hidden', val !== 'personal');
        if (val !== 'personal' && personalSelectorEdit) {
            personalSelectorEdit.hideResults();
        }
    };
    ownerTypeSelect.onchange = (e) => toggleEditOptions(e.target.value);
    toggleEditOptions(ownerTypeSelect.value);
    
    document.getElementById('editJobName').onchange = (e) => {
        if (e.target.value) {
            loadEditJobGrades(e.target.value, stash.jobGrade);
        }
    };
    
    document.getElementById('saveEditBtn').onclick = () => saveEdit();
    document.getElementById('cancelEditBtn').onclick = () => closeEditModal();
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) {
        document.body.removeChild(modal);
    }
    if (personalSelectorEdit) {
        personalSelectorEdit.destroy();
        personalSelectorEdit = null;
    }
    currentEditStash = null;
}

async function loadEditJobsList(selectedJob) {
    const response = await post('getJobs', {});
    if (!response) return;
    const data = await response.json();
    
    const select = document.getElementById('editJobName');
    select.innerHTML = '<option value="">Sélectionner un métier</option>';
    
    data.forEach(job => {
        const option = document.createElement('option');
        option.value = job.name;
        option.textContent = job.label;
        if (job.name === selectedJob) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    
    if (selectedJob) {
        loadEditJobGrades(selectedJob, currentEditStash.jobGrade);
    }
}

async function loadEditJobGrades(jobName, selectedGrade) {
    const response = await post('getJobGrades', { jobName });
    if (!response) return;
    const data = await response.json();
    
    const select = document.getElementById('editJobGrade');
    select.innerHTML = '';
    
    // Si aucun grade n'est sélectionné, utiliser le grade 0 par défaut
    const gradeToSelect = selectedGrade !== undefined && selectedGrade !== null ? selectedGrade : 0;
    
    data.forEach(grade => {
        const option = document.createElement('option');
        option.value = grade.grade;
        option.textContent = `${grade.label} (Grade ${grade.grade})`;
        if (grade.grade == gradeToSelect) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

async function loadEditCrewsList(selectedCrew) {
    const response = await post('getCrews', {});
    if (!response) return;
    const data = await response.json();
    
    const select = document.getElementById('editCrewName');
    select.innerHTML = '<option value="">Sélectionner un crew</option>';
    
    // Supprimer l'ancien listener s'il existe
    const oldHandler = select.onchange;
    if (oldHandler) {
        select.removeEventListener('change', oldHandler);
    }
    
    data.forEach(crew => {
        const option = document.createElement('option');
        option.value = crew.id_crew;
        option.textContent = crew.name;
        if (crew.id_crew == selectedCrew) {
            option.selected = true;
            // Charger les grades et remplir le select
            loadEditCrewGrades(crew.id_crew, currentEditStash.crewGradeRang).then(rang => {
                if (rang !== null) {
                    select.dataset.defaultRang = rang;
                }
            });
        }
        select.appendChild(option);
    });
    
    // Ajouter l'event listener pour charger les grades quand un crew est sélectionné
    select.onchange = async function(e) {
        const crewId = e.target.value;
        if (crewId) {
            const defaultRang = await loadEditCrewGrades(crewId, null);
            if (defaultRang !== null) {
                select.dataset.defaultRang = defaultRang;
            }
        } else {
            const gradeSelect = document.getElementById('editCrewGrade');
            if (gradeSelect) {
                gradeSelect.innerHTML = '<option value="">Sélectionner d\'abord un crew</option>';
            }
        }
    };
}

async function loadEditCrewGrades(crewId, selectedRang) {
    const response = await post('getCrewGrades', { crewId: crewId });
    if (!response) return null;
    const data = await response.json();
    
    const gradeSelect = document.getElementById('editCrewGrade');
    if (!gradeSelect) return null;
    
    gradeSelect.innerHTML = '';
    
    let defaultRang = null;
    if (data && data.length > 0) {
        // Les grades sont déjà triés par rang DESC (rang le plus élevé en premier)
        defaultRang = data[0].rang;
        
        // Si un rang est déjà sélectionné, l'utiliser, sinon utiliser le rang par défaut
        const rangToSelect = selectedRang !== undefined && selectedRang !== null ? selectedRang : defaultRang;
        
        data.forEach(grade => {
            const option = document.createElement('option');
            option.value = grade.rang;
            option.textContent = `${grade.name} (Rang ${grade.rang})`;
            if (grade.rang == rangToSelect) {
                option.selected = true;
            }
            gradeSelect.appendChild(option);
        });
    }
    
    return defaultRang;
}

function saveEdit() {
    const label = document.getElementById('editLabel').value.trim();
    const slots = parseInt(document.getElementById('editSlots').value) || 50;
    const weight = parseInt(document.getElementById('editWeight').value) || 100000;
    const ownerType = document.getElementById('editOwnerType').value;
    const updateCoords = document.getElementById('updateCoords').checked;
    
    if (!label) {
        alert('Veuillez saisir un nom');
        return;
    }
    
    const data = {
        id: currentEditStash.id,
        label: label,
        slots: slots,
        weight: weight,
        ownerType: ownerType,
        updateCoords: updateCoords
    };
    
    if (ownerType === 'job') {
        const jobName = document.getElementById('editJobName').value;
        const jobGradeSelect = document.getElementById('editJobGrade');
        const jobGrade = jobGradeSelect.value !== '' ? parseInt(jobGradeSelect.value) : 0;
        
        if (!jobName) {
            alert('Veuillez sélectionner un métier');
            return;
        }
        
        // Le grade 0 est sélectionné par défaut, donc on l'utilise même si non explicitement sélectionné
        data.jobName = jobName;
        data.jobGrade = isNaN(jobGrade) ? 0 : jobGrade;
    } else if (ownerType === 'crew') {
        const crewValue = document.getElementById('editCrewName').value;
        const crewId = parseInt(crewValue, 10);
        
        if (!crewValue || Number.isNaN(crewId)) {
            alert('Veuillez sélectionner un crew');
            return;
        }
        
        data.crewId = crewId;
        
        // Récupérer le grade sélectionné ou utiliser le grade par défaut
        const crewGradeSelect = document.getElementById('editCrewGrade');
        const selectedRang = crewGradeSelect.value !== '' ? parseInt(crewGradeSelect.value, 10) : null;
        
        if (selectedRang !== null && !isNaN(selectedRang)) {
            data.crewGradeRang = selectedRang;
        } else {
            // Utiliser le rang par défaut (grade le plus bas) si aucun grade n'est sélectionné
            const defaultRang = document.getElementById('editCrewName').dataset.defaultRang;
            if (defaultRang) {
                data.crewGradeRang = parseInt(defaultRang, 10);
            }
        }
    } else if (ownerType === 'personal') {
        const selected = personalSelectorEdit ? personalSelectorEdit.getSelected() : [];
        if (!selected.length) {
            alert('Veuillez ajouter au moins une personne.');
            return;
        }
        data.personalMembers = selected;
    }
    
    post('editStash', data);
    closeEditModal();
    
    // Rafraîchir la liste
    setTimeout(() => {
        post('refreshManageUI', {});
    }, 200);
}

// Récupérer la config au chargement
async function loadConfig() {
    const response = await post('getConfig', {});
    if (response) {
        const config = await response.json();
        useTerritory = config.useTerritory;
    }
}

// Écouter les messages du client
window.addEventListener('message', function(event) {
    const data = event.data;
    
    if (data.type === 'openUI') {
        loadConfig().then(() => openUI());
    } else if (data.type === 'closeUI') {
        closeUI();
    } else if (data.type === 'openManageUI') {
        loadConfig().then(() => openManageUI(data.stashes));
    } else if (data.type === 'closeManageUI') {
        closeManageUI();
    }
});

