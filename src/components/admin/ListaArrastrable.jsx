import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

// Fila arrastrable individual — envuelve lo que sea que `renderItem`
// devuelva sin saber nada de su contenido: todo lo que necesita es un
// `id` único, igual que cualquier lista de dnd-kit. El handle (ícono de
// agarre) es el ÚNICO elemento con los listeners de arrastre — así el
// resto de la fila (botones Editar/Eliminar, texto) sigue siendo
// clickeable normal, sin pelearse con el gesto de drag.
//
// `Tag`/`className` son parametrizables (antes venían fijos a
// <li className="tz-history-row ...">, pensado solo para
// ConfigurarMembresiasModal.jsx) para poder reusar este mismo
// componente en listas con otro esqueleto visual — ej.
// AdminLocalidadesModal.jsx usa <div className="tz-stock-row">, no
// <li>/tz-history-row.
function FilaArrastrable({ id, Tag, className, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Tag
      ref={setNodeRef}
      style={style}
      className={`${className} tz-paquete-draggable-li ${isDragging ? "tz-paquete-dragging" : ""}`}
    >
      <button
        type="button"
        className="tz-drag-handle"
        aria-label="Arrastrar para reordenar"
        title="Arrastrar para reordenar"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </Tag>
  );
}

// Lista reordenable genérica (dnd-kit): recibe los `items` YA
// filtrados/ordenados como los ve el usuario y un `renderItem` que
// dibuja cada fila. Al soltar, calcula el nuevo array completo con
// arrayMove y se lo pasa entero a `onReordenar` — quien la use decide
// cómo persistir eso (ver reordenarPaquetes en usePaquetes.js/
// usePaquetesRecolectores.js/useLocalidades.js, que lo escriben como
// `orden: index` fila por fila).
//
// Tres sensores a propósito: Pointer (mouse/trackpad en desktop),
// Touch con un pequeño delay (celular — sin el delay, un scroll normal
// de la lista se confundiría con un intento de arrastre) y Keyboard
// (accesibilidad — flechas para reordenar sin mouse ni dedo).
//
// `wrapperTag`/`wrapperClassName`/`itemTag`/`itemClassName` tienen
// default = el esqueleto que ya usaba ConfigurarMembresiasModal.jsx
// (<ul className="tz-history-rows"> de <li className="tz-history-row">),
// así ese caller sigue funcionando tal cual sin tocarle una línea.
export default function ListaArrastrable({
  items,
  onReordenar,
  renderItem,
  vacio = null,
  wrapperTag: WrapperTag = "ul",
  wrapperClassName = "tz-history-rows",
  itemTag = "li",
  itemClassName = "tz-history-row",
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReordenar(arrayMove(items, oldIndex, newIndex));
  };

  if (items.length === 0) return vacio;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <WrapperTag className={wrapperClassName}>
          {items.map((item) => (
            <FilaArrastrable key={item.id} id={item.id} Tag={itemTag} className={itemClassName}>
              {renderItem(item)}
            </FilaArrastrable>
          ))}
        </WrapperTag>
      </SortableContext>
    </DndContext>
  );
}
